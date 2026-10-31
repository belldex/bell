import { LoaderCircle } from 'lucide-react';

type AppLoadingStateProps = {
  label: string;
  variant?: 'page' | 'cards' | 'detail' | 'inline';
};

export function AppLoadingState({ label, variant = 'page' }: AppLoadingStateProps) {
  if (variant === 'inline') {
    return (
      <div className="app-loading app-loading--inline" role="status" aria-live="polite" aria-busy="true">
        <LoaderCircle className="app-loading__spinner" size={16} aria-hidden="true" />
        <span>{label}</span>
        <span className="app-loading__inline-bar" aria-hidden="true" />
      </div>
    );
  }

  return (
    <section className={`app-loading app-loading--${variant}`} role="status" aria-live="polite" aria-busy="true">
      <div className="app-loading__heading">
        <span className="app-loading__icon"><LoaderCircle className="app-loading__spinner" size={16} aria-hidden="true" /></span>
        <span>{label}</span>
      </div>
      {variant === 'cards' ? (
        <div className="app-loading__cards" aria-hidden="true">
          {[0, 1].map((item) => <div className="app-loading__card" key={item}><i /><i /><i /><i /></div>)}
        </div>
      ) : variant === 'detail' ? (
        <div className="app-loading__detail" aria-hidden="true">
          <div className="app-loading__metrics">{[0, 1, 2, 3].map((item) => <div key={item}><i /><i /></div>)}</div>
          <div className="app-loading__panel"><i /><i /><i /></div>
        </div>
      ) : (
        <div className="app-loading__page" aria-hidden="true">
          <i className="app-loading__title" />
          <i className="app-loading__copy" />
          <i className="app-loading__copy app-loading__copy--short" />
          <div className="app-loading__cards"><div className="app-loading__card"><i /><i /><i /><i /></div><div className="app-loading__card"><i /><i /><i /><i /></div></div>
        </div>
      )}
    </section>
  );
}
