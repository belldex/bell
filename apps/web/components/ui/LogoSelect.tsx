'use client';

import { useEffect, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/format';
import { TokenLogo, TokenPair } from '@/components/ui/TokenLogo';

export interface LogoSelectOption {
  value: string;
  label: string;
  detail?: string;
  symbols?: string[];
}

interface LogoSelectProps {
  id: string;
  labelId: string;
  value: string;
  options: LogoSelectOption[];
  onChange: (value: string) => void;
  className?: string;
}

function AssetMarks({ symbols }: { symbols?: string[] }) {
  if (!symbols?.length) return null;
  if (symbols.length === 1) return <TokenLogo symbol={symbols[0]} size={26} />;
  return <TokenPair symbols={[symbols[0], symbols[1]]} size={25} />;
}

export function LogoSelect({ id, labelId, value, options, onChange, className }: LogoSelectProps) {
  const [open, setOpen] = useState(false);
  const selectedIndex = Math.max(0, options.findIndex((option) => option.value === value));
  const [activeIndex, setActiveIndex] = useState(selectedIndex);
  const [opensAbove, setOpensAbove] = useState(false);
  const [menuMaxHeight, setMenuMaxHeight] = useState(288);
  const rootRef = useRef<HTMLDivElement>(null);
  const listboxRef = useRef<HTMLDivElement>(null);
  const optionRefs = useRef<Array<HTMLDivElement | null>>([]);
  const selected = options[selectedIndex];

  useEffect(() => {
    if (!open) return;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', closeOnOutsidePointer);
    return () => document.removeEventListener('pointerdown', closeOnOutsidePointer);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const updatePlacement = () => {
      const bounds = rootRef.current?.getBoundingClientRect();
      if (!bounds) return;
      const gap = 8;
      const spaceBelow = Math.max(0, window.innerHeight - bounds.bottom - gap);
      const spaceAbove = Math.max(0, bounds.top - gap);
      const shouldOpenAbove = spaceBelow < 220 && spaceAbove > spaceBelow;
      const availableSpace = shouldOpenAbove ? spaceAbove : spaceBelow;
      setOpensAbove(shouldOpenAbove);
      setMenuMaxHeight(Math.max(60, Math.min(288, availableSpace)));
    };
    updatePlacement();
    window.addEventListener('resize', updatePlacement);
    window.addEventListener('scroll', updatePlacement, true);
    return () => {
      window.removeEventListener('resize', updatePlacement);
      window.removeEventListener('scroll', updatePlacement, true);
    };
  }, [open]);

  useEffect(() => {
    const listbox = listboxRef.current;
    const option = optionRefs.current[activeIndex];
    if (!open || !listbox || !option) return;
    const listBounds = listbox.getBoundingClientRect();
    const optionBounds = option.getBoundingClientRect();
    if (optionBounds.top < listBounds.top) listbox.scrollTop -= listBounds.top - optionBounds.top;
    else if (optionBounds.bottom > listBounds.bottom) listbox.scrollTop += optionBounds.bottom - listBounds.bottom;
  }, [activeIndex, open]);

  function handleKeyDown(event: React.KeyboardEvent<HTMLButtonElement>) {
    const currentIndex = selectedIndex;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveIndex((index) => open ? Math.min(options.length - 1, index + 1) : currentIndex);
      setOpen(true);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex((index) => open ? Math.max(0, index - 1) : currentIndex);
      setOpen(true);
    } else if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      setActiveIndex(event.key === 'Home' ? 0 : options.length - 1);
      setOpen(true);
    } else if ((event.key === 'Enter' || event.key === ' ') && open) {
      event.preventDefault();
      const next = options[activeIndex];
      if (next) onChange(next.value);
      setOpen(false);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      setOpen(false);
    }
  }

  return (
    <div ref={rootRef} className={cn('app-logo-select relative', className)}>
      <button
        id={id}
        type="button"
        role="combobox"
        aria-labelledby={labelId}
        aria-expanded={open}
        aria-controls={`${id}-listbox`}
        aria-haspopup="listbox"
        aria-activedescendant={open ? `${id}-option-${options[activeIndex]?.value}` : undefined}
        onClick={() => {
          if (!open) setActiveIndex(selectedIndex);
          setOpen((wasOpen) => !wasOpen);
        }}
        onKeyDown={handleKeyDown}
        className="app-logo-select__trigger flex min-h-11 w-full items-center gap-3 border border-line bg-bg-1 px-4 text-left text-ink outline-none transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-ion"
      >
        {selected && <AssetMarks symbols={selected.symbols} />}
        <span className="min-w-0 flex-1 truncate text-sm font-medium">{selected?.label ?? value}</span>
        {selected?.detail && <span className="hidden font-mono text-[9px] uppercase tracking-[0.1em] text-dim sm:inline">{selected.detail}</span>}
        <ChevronDown className={cn('h-4 w-4 shrink-0 text-dim transition-transform', open && 'rotate-180')} aria-hidden="true" />
      </button>
      {open && (
        <div
          ref={listboxRef}
          id={`${id}-listbox`}
          role="listbox"
          aria-labelledby={labelId}
          onWheel={(event) => {
            const listbox = event.currentTarget;
            const maxScroll = listbox.scrollHeight - listbox.clientHeight;
            const nextScroll = Math.max(0, Math.min(maxScroll, listbox.scrollTop + event.deltaY));
            if (nextScroll !== listbox.scrollTop) {
              event.preventDefault();
              listbox.scrollTop = nextScroll;
            }
            event.stopPropagation();
          }}
          style={{ maxHeight: menuMaxHeight }}
          className={cn('app-logo-select__listbox absolute inset-x-0 z-30 overflow-y-auto overscroll-contain border border-line-strong bg-surface shadow-xl', opensAbove ? 'bottom-full mb-1' : 'top-full mt-1')}
        >
          {options.map((option, index) => (
            <div
              key={option.value}
              ref={(node) => { optionRefs.current[index] = node; }}
              id={`${id}-option-${option.value}`}
              role="option"
              aria-selected={option.value === value}
              data-active={index === activeIndex}
              onMouseEnter={() => setActiveIndex(index)}
              onClick={() => {
                onChange(option.value);
                setActiveIndex(index);
                setOpen(false);
              }}
              className="app-logo-select__option flex min-h-14 cursor-pointer items-center gap-3 border-b border-line px-4 py-2.5 text-ink transition-colors last:border-b-0"
            >
              <AssetMarks symbols={option.symbols} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{option.label}</span>
                {option.detail && <span className="mt-0.5 block font-mono text-[9px] uppercase tracking-[0.08em] text-muted">{option.detail}</span>}
              </span>
              {option.value === value && <span className="app-logo-select__selected font-mono text-[9px] uppercase tracking-[0.08em]">Selected</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
