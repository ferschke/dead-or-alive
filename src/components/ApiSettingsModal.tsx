import React, { useState } from 'react';
import {
  CheckCircle2,
  Database,
  KeyRound,
  Trash2,
  X,
} from 'lucide-react';
import type { CatalogMediaWork } from '../services/catalogStorage';
import { validateTmdbKey } from '../services/tmdbService';

interface ApiSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentTmdbKey: string;
  onSaveTmdbKey: (key: string) => void;
  catalogWorks: CatalogMediaWork[];
  onSelectCatalogWork: (id: string) => void;
  onRemoveCachedWork: (id: string) => void;
  onClearUserCache: () => void;
}

export const ApiSettingsModal: React.FC<ApiSettingsModalProps> = ({
  isOpen,
  onClose,
  currentTmdbKey,
  onSaveTmdbKey,
  catalogWorks,
  onSelectCatalogWork,
  onRemoveCachedWork,
  onClearUserCache,
}) => {
  const [inputKey, setInputKey] = useState(currentTmdbKey);
  const [testing, setTesting] = useState(false);
  const [statusMsg, setStatusMsg] = useState<{
    type: 'ok' | 'err';
    text: string;
  } | null>(null);

  if (!isOpen) return null;

  const userCachedWorks = catalogWorks.filter((w) => w.isUserCached);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleaned = inputKey.trim();
    if (!cleaned) {
      onSaveTmdbKey('');
      setStatusMsg(null);
      onClose();
      return;
    }

    setTesting(true);
    setStatusMsg(null);
    const valid = await validateTmdbKey(cleaned);
    setTesting(false);

    if (valid) {
      onSaveTmdbKey(cleaned);
      setStatusMsg({
        type: 'ok',
        text: 'TMDB API key verified and saved. Additional TMDB data will be used and cached.',
      });
      setTimeout(() => {
        onClose();
      }, 750);
    } else {
      setStatusMsg({
        type: 'err',
        text: 'Could not verify TMDB key. Please check your v3 API Key or v4 Read Access Token.',
      });
    }
  };

  return (
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="modal-settings-title"
    >
      <div className="modal-card" style={{ maxWidth: '560px' }}>
        <div className="modal-header">
          <h2 className="modal-title" id="modal-settings-title">
            Configuration &amp; Persistent Catalog
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close configuration dialog"
            style={{ color: 'var(--text-secondary)' }}
          >
            <X size={18} />
          </button>
        </div>

        <form className="modal-body" onSubmit={handleSave}>
          <p>
            Titles not yet in your local catalog are automatically retrieved
            from the <strong>Wikidata API</strong> and cached locally across
            sessions. When a <strong>TMDB API Key</strong> is configured below,
            additional TMDB cast, role, poster, and biographical data are
            fetched and merged into the cached catalog entry.
          </p>

          <div>
            <label
              htmlFor="tmdb-api-key-input"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.4rem',
                fontSize: '0.8rem',
                fontWeight: 600,
                color: 'var(--text-primary)',
                marginBottom: '0.4rem',
              }}
            >
              <KeyRound size={14} /> TMDB API Key (v3 Key or v4 Read Access
              Token)
            </label>
            <input
              id="tmdb-api-key-input"
              type="password"
              className="modal-input"
              placeholder="Paste TMDB API key here (persisted in localStorage)..."
              value={inputKey}
              onChange={(e) => setInputKey(e.target.value)}
            />
          </div>

          {statusMsg && (
            <div
              style={{
                fontSize: '0.82rem',
                display: 'flex',
                alignItems: 'center',
                gap: '0.4rem',
                color:
                  statusMsg.type === 'ok'
                    ? 'var(--alive-text)'
                    : 'var(--deceased-text)',
              }}
            >
              {statusMsg.type === 'ok' && <CheckCircle2 size={15} />}
              <span>{statusMsg.text}</span>
            </div>
          )}

          {/* Persistent Catalog Summary */}
          <div
            style={{
              background: 'var(--bg-elevated)',
              border: '1px solid var(--border-default)',
              borderRadius: 'var(--radius-sm)',
              padding: '0.85rem',
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                marginBottom: '0.5rem',
              }}
            >
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.4rem',
                  fontSize: '0.8rem',
                  fontWeight: 600,
                  color: 'var(--text-primary)',
                }}
              >
                <Database size={14} /> Persistent Local Catalog (
                {catalogWorks.length} total · {userCachedWorks.length} retrieved
                &amp; cached)
              </span>

              {userCachedWorks.length > 0 && (
                <button
                  type="button"
                  onClick={onClearUserCache}
                  style={{
                    fontSize: '0.75rem',
                    color: 'var(--deceased-text)',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '0.25rem',
                  }}
                >
                  <Trash2 size={12} /> Clear Retrieved Cache
                </button>
              )}
            </div>

            {userCachedWorks.length === 0 ? (
              <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                Any new movie or show you query from Wikidata or TMDB will be
                automatically cached here and persisted across browser sessions.
              </div>
            ) : (
              <div
                style={{
                  maxHeight: '140px',
                  overflowY: 'auto',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '0.35rem',
                }}
              >
                {userCachedWorks.map((w) => (
                  <div
                    key={w.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '0.35rem 0.55rem',
                      borderRadius: '4px',
                      background: 'var(--bg-surface)',
                      border: '1px solid var(--border-subtle)',
                      fontSize: '0.78rem',
                    }}
                  >
                    <button
                      type="button"
                      onClick={() => {
                        onSelectCatalogWork(w.id);
                        onClose();
                      }}
                      style={{
                        textAlign: 'left',
                        color: 'var(--text-primary)',
                        fontWeight: 500,
                      }}
                    >
                      {w.title} {w.releaseYear ? `(${w.releaseYear})` : ''} —{' '}
                      <span style={{ color: 'var(--accent-gold)' }}>
                        {w.cast.length} actors
                      </span>
                      {w.hasTmdbEnrichment ? ' · +TMDB' : ' · Wikidata'}
                    </button>
                    <button
                      type="button"
                      onClick={() => onRemoveCachedWork(w.id)}
                      title="Remove from cached catalog"
                      style={{ color: 'var(--text-muted)' }}
                    >
                      <X size={13} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="modal-actions">
            {currentTmdbKey && (
              <button
                type="button"
                className="btn-secondary"
                onClick={() => {
                  setInputKey('');
                  onSaveTmdbKey('');
                  onClose();
                }}
              >
                Remove TMDB Key
              </button>
            )}
            <button type="button" className="btn-secondary" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn-primary" disabled={testing}>
              {testing ? 'Verifying...' : 'Save Configuration'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
