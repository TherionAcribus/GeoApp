import * as React from 'react';
import { GeoAppChatWorkflowProfile } from './geoapp-chat-agent';

const PROFILE_OPTIONS: Array<{ value: GeoAppChatWorkflowProfile; label: string; description: string }> = [
    { value: 'default', label: 'Auto', description: 'Profil determine automatiquement' },
    { value: 'fast', label: 'Fast', description: 'Modele rapide et economique' },
    { value: 'strong', label: 'Strong', description: 'Modele plus puissant' },
    { value: 'web', label: 'Web', description: 'Modele web (peut etre connecte)' },
    { value: 'local', label: 'Local', description: 'Modele local' },
];

export interface FreeChatDialogOptions {
    initialDraft: string;
    initialImageUrls?: string[];
    initialProfile: GeoAppChatWorkflowProfile;
    geocacheName: string;
    gcCode?: string;
}

export interface FreeChatDialogResult {
    draft: string;
    imageUrls: string[];
    profile: GeoAppChatWorkflowProfile;
}

interface FreeChatDialogProps {
    options: FreeChatDialogOptions;
    onConfirm: (result: FreeChatDialogResult) => void;
    onCancel: () => void;
}

export const FreeChatDialog: React.FC<FreeChatDialogProps> = ({ options, onConfirm, onCancel }) => {
    const [draft, setDraft] = React.useState(options.initialDraft);
    const [imageUrlsText, setImageUrlsText] = React.useState(
        (options.initialImageUrls || []).join('\n')
    );
    const [profile, setProfile] = React.useState<GeoAppChatWorkflowProfile>(options.initialProfile);
    const [showImages, setShowImages] = React.useState((options.initialImageUrls || []).length > 0);

    const handleConfirm = (): void => {
        const imageUrls = imageUrlsText
            .split('\n')
            .map(u => u.trim())
            .filter(Boolean);
        onConfirm({ draft, imageUrls, profile });
    };

    const handleKeyDown = (e: React.KeyboardEvent): void => {
        if (e.key === 'Escape') {
            onCancel();
        }
    };

    return (
        <div
            style={{
                position: 'fixed',
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                background: 'rgba(0, 0, 0, 0.55)',
                display: 'flex',
                justifyContent: 'center',
                alignItems: 'center',
                zIndex: 10000,
            }}
            onClick={onCancel}
            onKeyDown={handleKeyDown}
        >
            <div
                style={{
                    background: 'var(--theia-editor-background)',
                    border: '1px solid var(--theia-panel-border)',
                    borderRadius: 6,
                    padding: 24,
                    width: 700,
                    maxWidth: '92vw',
                    maxHeight: '88vh',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 16,
                    boxShadow: '0 8px 32px rgba(0, 0, 0, 0.35)',
                }}
                onClick={e => e.stopPropagation()}
            >
                <div>
                    <h3 style={{ margin: '0 0 2px 0', fontSize: '1.1em' }}>Chat Libre</h3>
                    <div style={{ fontSize: 12, opacity: 0.6 }}>
                        {options.gcCode ? `${options.gcCode} — ` : ''}{options.geocacheName}
                    </div>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flex: 1, minHeight: 0 }}>
                    <label style={{ fontSize: 12, opacity: 0.7 }}>
                        Message initial — modifiable avant envoi
                    </label>
                    <textarea
                        value={draft}
                        onChange={e => setDraft(e.target.value)}
                        style={{
                            flex: 1,
                            minHeight: 260,
                            maxHeight: 380,
                            padding: '8px 10px',
                            fontFamily: 'var(--theia-code-font-family, monospace)',
                            fontSize: 12,
                            lineHeight: 1.5,
                            resize: 'vertical',
                            background: 'var(--theia-input-background)',
                            color: 'var(--theia-input-foreground)',
                            border: '1px solid var(--theia-input-border)',
                            borderRadius: 4,
                            boxSizing: 'border-box',
                        }}
                        spellCheck={false}
                        // eslint-disable-next-line jsx-a11y/no-autofocus
                        autoFocus
                    />
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <label style={{ fontSize: 12, opacity: 0.7 }}>Images</label>
                        <button
                            className='theia-button secondary'
                            onClick={() => setShowImages(v => !v)}
                            style={{ fontSize: 11, padding: '2px 8px' }}
                            title={showImages ? 'Masquer la section images' : 'Ajouter des URLs d\'images a inclure'}
                        >
                            {showImages ? 'Masquer' : '+ Ajouter des images'}
                        </button>
                    </div>
                    {showImages && (
                        <textarea
                            value={imageUrlsText}
                            onChange={e => setImageUrlsText(e.target.value)}
                            placeholder={'https://example.com/image1.jpg\nhttps://example.com/image2.jpg'}
                            style={{
                                minHeight: 72,
                                padding: '6px 10px',
                                fontFamily: 'var(--theia-code-font-family, monospace)',
                                fontSize: 11,
                                resize: 'vertical',
                                background: 'var(--theia-input-background)',
                                color: 'var(--theia-input-foreground)',
                                border: '1px solid var(--theia-input-border)',
                                borderRadius: 4,
                                boxSizing: 'border-box',
                            }}
                            spellCheck={false}
                        />
                    )}
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <label style={{ fontSize: 12, opacity: 0.7 }}>Profil IA</label>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                        {PROFILE_OPTIONS.map(opt => (
                            <button
                                key={opt.value}
                                className={`theia-button${profile === opt.value ? '' : ' secondary'}`}
                                onClick={() => setProfile(opt.value)}
                                title={opt.description}
                                style={{ fontSize: 12, padding: '4px 12px' }}
                            >
                                {opt.label}
                            </button>
                        ))}
                    </div>
                </div>

                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, paddingTop: 4 }}>
                    <button
                        onClick={onCancel}
                        className='theia-button secondary'
                        style={{ padding: '6px 16px' }}
                    >
                        Annuler
                    </button>
                    <button
                        onClick={handleConfirm}
                        className='theia-button'
                        style={{ padding: '6px 16px' }}
                        disabled={!draft.trim()}
                    >
                        Ouvrir le Chat
                    </button>
                </div>
            </div>
        </div>
    );
};
