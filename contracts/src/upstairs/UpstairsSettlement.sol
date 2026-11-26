// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {SignatureChecker} from "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {AssetDescriptor, CalendarLeaf, MarketPhase} from "../types/ProtocolTypes.sol";
import {AggregatorV3Interface} from "../interfaces/AggregatorV3Interface.sol";

interface IUpstairsAssetRegistry {
    function descriptorIdForToken(address token) external view returns (bytes32);
    function descriptor(bytes32 descriptorId) external view returns (AssetDescriptor memory);
}

interface IUpstairsCalendar {
    function currentInterval(bytes32 assetId) external view returns (CalendarLeaf memory);
}

/// @dev Same shape as HaltRegistry.phase: 0 NORMAL, 1 HALTED, 2 RESUME_AUCTION.
interface IUpstairsHalt {
    function phase(bytes32 assetId) external view returns (uint8);
}

/// @title UpstairsSettlement
/// @notice Block trades of a stock token for USDG between two named wallets, settled in one transaction without touching any BELL pool.
/// @dev One immutable contract: no proxy, no owner, no setter. Everything is fixed in the constructor. The contract never holds funds: tokens
///      move straight from maker to taker inside `fill`, and every failed check reverts with nothing moved. The maker signs an EIP-712 quote off
///      chain (a contract wallet can sign through ERC-1271); only the named taker can fill it, once, within 120 seconds.
///
///      Reference price: the Chainlink feed registered for the stock token at deploy, and only while its round is at most `MAX_FEED_AGE`
///      seconds old. v1 has no TWAP fallback, so an asset with no feed (ANT today) cannot trade here and reverts with `NoReference`.
///      The pool's spot price is never read. The session comes from the same CalendarRegistry the hooks use; CLOSED, UNKNOWN, no active
///      interval, or a halt on the HaltRegistry all revert with `UpstairsClosed`.
contract UpstairsSettlement is EIP712 {
    using SafeERC20 for IERC20;

    struct BlockQuote {
        address maker;
        address taker;
        address stockToken;
        address quoteToken;
        bool makerSells;
        uint256 stockAmount;
        uint256 price; // quote token per whole stock token, scaled by 1e18
        uint64 expiry;
        uint256 nonce;
    }

    bytes32 public constant BLOCK_QUOTE_TYPEHASH = keccak256(
        "BlockQuote(address maker,address taker,address stockToken,address quoteToken,bool makerSells,uint256 stockAmount,uint256 price,uint64 expiry,uint256 nonce)"
    );
    uint256 public constant FEE_BPS = 5;
    uint256 public constant MAX_QUOTE_SECONDS = 120;
    uint256 public constant BAND_REGULAR_BPS = 50;
    uint256 public constant BAND_EXTENDED_BPS = 100; // PRE and POST
    uint256 public constant BAND_OVERNIGHT_BPS = 150;

    IUpstairsAssetRegistry public immutable ASSET_REGISTRY;
    IUpstairsCalendar public immutable CALENDAR_REGISTRY;
    IUpstairsHalt public immutable HALT_REGISTRY; // zero address: no halt check
    address public immutable QUOTE_TOKEN;
    uint8 public immutable QUOTE_DECIMALS;
    address public immutable FEE_RECIPIENT;
    uint256 public immutable MIN_NOTIONAL; // in quote token units
    uint256 public immutable MAX_NOTIONAL; // the block cap while there is no independent audit, in quote token units
    uint32 public immutable MAX_FEED_AGE;

    mapping(address stockToken => address feed) public referenceFeed;
    mapping(address maker => mapping(uint256 nonce => bool used)) public nonceUsed;

    event BlockPrint(
        address indexed stockToken,
        address indexed maker,
        address indexed taker,
        bool makerSells,
        uint256 stockAmount,
        uint256 price,
        uint256 referencePrice,
        uint8 session,
        uint256 feeUsdg
    );
    event NonceCancelled(address indexed maker, uint256 indexed nonce);

    error BadQuote();
    error Expired();
    error ExpiryTooFar();
    error NonceUsed();
    error AssetNotAdmitted();
    error BelowBlockSize();
    error AboveBlockCap();
    error UpstairsClosed();
    error NoReference();
    error StaleReference();
    error OutsideBand();
    error BadConfig();

    constructor(
        address assetRegistry,
        address calendarRegistry,
        address haltRegistry,
        address quoteToken,
        address feeRecipient,
        uint256 minNotional,
        uint256 maxNotional,
        uint32 maxFeedAge,
        address[] memory stockTokens,
        address[] memory feeds
    ) EIP712("BELL Upstairs", "1") {
        if (
            assetRegistry == address(0) || calendarRegistry == address(0) || quoteToken == address(0) || feeRecipient == address(0)
                || minNotional == 0 || maxNotional < minNotional || maxFeedAge == 0 || stockTokens.length != feeds.length
        ) revert BadConfig();
        ASSET_REGISTRY = IUpstairsAssetRegistry(assetRegistry);
        CALENDAR_REGISTRY = IUpstairsCalendar(calendarRegistry);
        HALT_REGISTRY = IUpstairsHalt(haltRegistry);
        QUOTE_TOKEN = quoteToken;
        QUOTE_DECIMALS = IERC20Metadata(quoteToken).decimals();
        FEE_RECIPIENT = feeRecipient;
        MIN_NOTIONAL = minNotional;
        MAX_NOTIONAL = maxNotional;
        MAX_FEED_AGE = maxFeedAge;
        for (uint256 i; i < stockTokens.length; ++i) {
            if (stockTokens[i] == address(0) || feeds[i] == address(0) || referenceFeed[stockTokens[i]] != address(0)) revert BadConfig();
            referenceFeed[stockTokens[i]] = feeds[i];
        }
    }

    /// @notice The EIP-712 digest a maker signs.
    function quoteDigest(BlockQuote calldata q) public view returns (bytes32) {
        return _hashTypedDataV4(
            keccak256(
                abi.encode(
                    BLOCK_QUOTE_TYPEHASH, q.maker, q.taker, q.stockToken, q.quoteToken, q.makerSells, q.stockAmount, q.price, q.expiry, q.nonce
                )
            )
        );
    }

    function domainSeparator() external view returns (bytes32) {
        return _domainSeparatorV4();
    }

    /// @notice A maker cancels a quote it signed but has not had filled. Nothing else can spend that nonce.
    function cancelNonce(uint256 nonce) external {
        nonceUsed[msg.sender][nonce] = true;
        emit NonceCancelled(msg.sender, nonce);
    }

    /// @notice Fill a quote. Only the named taker can call it. Reverts with a named error on the first failed check.
    function fill(BlockQuote calldata q, bytes calldata signature) external returns (uint256 quoteAmount, uint256 fee) {
        // 1. The quote itself.
        if (q.taker != msg.sender || q.maker == address(0) || q.quoteToken != QUOTE_TOKEN || q.stockAmount == 0 || q.price == 0) revert BadQuote();
        if (!SignatureChecker.isValidSignatureNow(q.maker, quoteDigest(q), signature)) revert BadQuote();
        if (q.expiry <= block.timestamp) revert Expired();
        if (q.expiry > block.timestamp + MAX_QUOTE_SECONDS) revert ExpiryTooFar();
        if (nonceUsed[q.maker][q.nonce]) revert NonceUsed();
        nonceUsed[q.maker][q.nonce] = true;

        // 2. The asset.
        bytes32 assetId = ASSET_REGISTRY.descriptorIdForToken(q.stockToken);
        if (assetId == bytes32(0)) revert AssetNotAdmitted();
        AssetDescriptor memory d = ASSET_REGISTRY.descriptor(assetId);
        if (!d.isStock || d.token != q.stockToken) revert AssetNotAdmitted();

        // 3. The size.
        if (QUOTE_DECIMALS > uint256(d.decimals) + 18) revert BadQuote();
        quoteAmount = Math.mulDiv(q.stockAmount, q.price, 10 ** (uint256(d.decimals) + 18 - QUOTE_DECIMALS));
        if (quoteAmount < MIN_NOTIONAL) revert BelowBlockSize();
        if (quoteAmount > MAX_NOTIONAL) revert AboveBlockCap();

        // 4. The session.
        uint8 session = _session(assetId);

        // 5. The price.
        uint256 refPrice = _referencePrice(q.stockToken);
        uint256 band = session == uint8(MarketPhase.REGULAR)
            ? BAND_REGULAR_BPS
            : session == uint8(MarketPhase.OVERNIGHT) ? BAND_OVERNIGHT_BPS : BAND_EXTENDED_BPS;
        uint256 diff = q.price > refPrice ? q.price - refPrice : refPrice - q.price;
        if (diff * 10_000 > refPrice * band) revert OutsideBand();

        // 6. Settlement. The taker bears the fee in USDG, whichever way the block goes.
        fee = Math.mulDiv(quoteAmount, FEE_BPS, 10_000, Math.Rounding.Ceil);
        IERC20 stock = IERC20(q.stockToken);
        IERC20 quote = IERC20(QUOTE_TOKEN);
        if (q.makerSells) {
            stock.safeTransferFrom(q.maker, q.taker, q.stockAmount);
            quote.safeTransferFrom(q.taker, q.maker, quoteAmount);
            quote.safeTransferFrom(q.taker, FEE_RECIPIENT, fee);
        } else {
            stock.safeTransferFrom(q.taker, q.maker, q.stockAmount);
            quote.safeTransferFrom(q.maker, q.taker, quoteAmount - fee);
            quote.safeTransferFrom(q.maker, FEE_RECIPIENT, fee);
        }
        emit BlockPrint(q.stockToken, q.maker, q.taker, q.makerSells, q.stockAmount, q.price, refPrice, session, fee);
    }

    function _session(bytes32 assetId) private view returns (uint8 phase) {
        CalendarLeaf memory leaf;
        try CALENDAR_REGISTRY.currentInterval(assetId) returns (CalendarLeaf memory l) {
            leaf = l;
        } catch {
            revert UpstairsClosed();
        }
        if (block.timestamp < leaf.start || block.timestamp >= leaf.end) revert UpstairsClosed();
        phase = leaf.phase;
        if (phase < uint8(MarketPhase.PRE) || phase > uint8(MarketPhase.OVERNIGHT)) revert UpstairsClosed();
        if (address(HALT_REGISTRY) != address(0) && HALT_REGISTRY.phase(assetId) != 0) revert UpstairsClosed();
    }

    /// @dev Chainlink only, only while fresh, never the pool's spot price. The result has 18 decimals.
    function _referencePrice(address stockToken) private view returns (uint256) {
        address feed = referenceFeed[stockToken];
        if (feed == address(0)) revert NoReference();
        (, int256 answer,, uint256 updatedAt,) = AggregatorV3Interface(feed).latestRoundData();
        if (answer <= 0 || updatedAt > block.timestamp || block.timestamp - updatedAt > MAX_FEED_AGE) revert StaleReference();
        uint8 feedDecimals = AggregatorV3Interface(feed).decimals();
        if (feedDecimals > 18) revert NoReference();
        return uint256(answer) * 10 ** (18 - feedDecimals);
    }
}
