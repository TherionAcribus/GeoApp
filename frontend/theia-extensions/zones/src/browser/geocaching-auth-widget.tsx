import * as React from 'react';
import { injectable, inject, postConstruct } from '@theia/core/shared/inversify';
import { ReactWidget, Message } from '@theia/core/lib/browser';
import { PreferenceService } from '@theia/core/lib/common/preferences/preference-service';

interface AuthState {
    status: 'not_configured' | 'logged_in' | 'logged_out' | 'login_failed' | 'captcha_required' | 'account_not_validated';
    method: 'none' | 'credentials' | 'browser_cookies';
    user: {
        username: string;
        user_type?: string;
        avatar_url?: string;
        reference_code?: string;
        finds_count?: number;
        hides_count?: number;
        favorite_points?: number;
        awarded_favorite_points?: number;
        stats_last_updated?: string;
    } | null;
    error_message: string | null;
    last_check: string | null;
}

interface AuthConfig {
    configured_method: string | null;
    has_saved_credentials: boolean;
}

@injectable()
export class GeocachingAuthWidget extends ReactWidget {
    static readonly ID = 'geocaching-auth-widget';
    static readonly LABEL = 'Connexion Geocaching.com';

    @inject(PreferenceService)
    protected readonly preferenceService: PreferenceService;

    protected authState: AuthState | null = null;
    protected authConfig: AuthConfig | null = null;
    protected loading: boolean = false;
    protected error: string | null = null;

    // Form state
    protected username: string = '';
    protected password: string = '';
    protected rememberCredentials: boolean = true;
    protected selectedBrowser: 'auto' | 'firefox' | 'chrome' | 'edge' = 'auto';
    protected selectedMethod: 'credentials' | 'browser_cookies' = 'credentials';

    @postConstruct()
    protected init(): void {
        this.id = GeocachingAuthWidget.ID;
        this.title.label = GeocachingAuthWidget.LABEL;
        this.title.caption = 'Gérer la connexion à Geocaching.com';
        this.title.closable = true;
        this.title.iconClass = 'codicon codicon-key';
        this.addClass('geocaching-auth-widget');
        
        this.fetchAuthStatus();
        this.fetchAuthConfig();
    }

    protected onActivateRequest(msg: Message): void {
        super.onActivateRequest(msg);
        this.fetchAuthStatus();
    }

    protected getApiBaseUrl(): string {
        return this.preferenceService.get<string>('geoApp.backend.apiBaseUrl', 'http://localhost:8000');
    }

    protected dispatchAuthChangeEvent(): void {
        // Émettre un événement personnalisé pour notifier les autres composants
        const event = new CustomEvent('geoapp-auth-changed', {
            detail: {
                status: this.authState?.status,
                isConnected: this.authState?.status === 'logged_in',
                user: this.authState?.user
            },
            bubbles: true,
            composed: true
        });
        window.dispatchEvent(event);
    }

    protected async fetchAuthStatus(): Promise<void> {
        console.log('[GeocachingAuth] fetchAuthStatus called');
        try {
            const baseUrl = this.getApiBaseUrl();
            const response = await fetch(`${baseUrl}/api/auth/status`);
            if (response.ok) {
                this.authState = await response.json();
                console.log('[GeocachingAuth] Auth status:', this.authState?.status, 'user:', this.authState?.user?.username);
                this.update();
                
                // Si connecté, récupérer les stats en arrière-plan
                if (this.authState?.status === 'logged_in') {
                    console.log('[GeocachingAuth] User is logged in, fetching profile stats...');
                    this.fetchProfileStatsQuietly();
                }
            }
        } catch (err) {
            console.error('[GeocachingAuth] Failed to fetch auth status:', err);
        }
    }

    protected async fetchAuthConfig(): Promise<void> {
        try {
            const baseUrl = this.getApiBaseUrl();
            const response = await fetch(`${baseUrl}/api/auth/config`);
            if (response.ok) {
                this.authConfig = await response.json();
                this.update();
            }
        } catch (err) {
            console.error('Failed to fetch auth config:', err);
        }
    }

    protected async loginWithCredentials(): Promise<void> {
        if (!this.username || !this.password) {
            this.error = 'Veuillez saisir votre nom d\'utilisateur et mot de passe';
            this.update();
            return;
        }

        this.loading = true;
        this.error = null;
        this.update();

        try {
            const baseUrl = this.getApiBaseUrl();
            const response = await fetch(`${baseUrl}/api/auth/login/credentials`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    username: this.username,
                    password: this.password,
                    remember: this.rememberCredentials
                })
            });

            const result = await response.json();
            
            if (result.success) {
                this.authState = result;
                this.password = ''; // Clear password for security
                this.error = null;
                // Émettre un événement pour notifier le changement d'état
                this.dispatchAuthChangeEvent();
                // Récupérer les stats du profil
                this.fetchProfileStatsQuietly();
            } else {
                this.error = result.error_message || 'Échec de la connexion';
                this.authState = result;
            }
        } catch (err) {
            this.error = 'Erreur de connexion au serveur';
            console.error('Login failed:', err);
        } finally {
            this.loading = false;
            this.update();
        }
    }

    protected async loginWithBrowser(): Promise<void> {
        this.loading = true;
        this.error = null;
        this.update();

        try {
            const baseUrl = this.getApiBaseUrl();
            const response = await fetch(`${baseUrl}/api/auth/login/browser`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    browser: this.selectedBrowser,
                    remember: true
                })
            });

            const result = await response.json();
            
            if (result.success) {
                this.authState = result;
                this.error = null;
                // Émettre un événement pour notifier le changement d'état
                this.dispatchAuthChangeEvent();
                // Récupérer les stats du profil
                this.fetchProfileStatsQuietly();
            } else {
                this.error = result.error_message || 'Échec de la connexion avec les cookies du navigateur';
                this.authState = result;
            }
        } catch (err) {
            this.error = 'Erreur de connexion au serveur';
            console.error('Browser login failed:', err);
        } finally {
            this.loading = false;
            this.update();
        }
    }

    protected async logout(): Promise<void> {
        this.loading = true;
        this.error = null;
        this.update();

        try {
            const baseUrl = this.getApiBaseUrl();
            const response = await fetch(`${baseUrl}/api/auth/logout`, {
                method: 'POST'
            });

            const result = await response.json();
            this.authState = result;
            this.username = '';
            this.password = '';
            // Émettre un événement pour notifier le changement d'état
            this.dispatchAuthChangeEvent();
        } catch (err) {
            this.error = 'Erreur lors de la déconnexion';
            console.error('Logout failed:', err);
        } finally {
            this.loading = false;
            this.update();
        }
    }

    protected async testConnection(): Promise<void> {
        this.loading = true;
        this.error = null;
        this.update();

        try {
            const baseUrl = this.getApiBaseUrl();
            const response = await fetch(`${baseUrl}/api/auth/test`);
            const result = await response.json();
            
            this.authState = result;
            if (!result.success) {
                this.error = 'La connexion a expiré ou est invalide';
            }
        } catch (err) {
            this.error = 'Erreur lors du test de connexion';
            console.error('Test failed:', err);
        } finally {
            this.loading = false;
            this.update();
        }
    }

    protected async refreshProfileStats(): Promise<void> {
        this.loading = true;
        this.error = null;
        this.update();

        try {
            const baseUrl = this.getApiBaseUrl();
            const response = await fetch(`${baseUrl}/api/auth/profile/refresh`, {
                method: 'POST'
            });
            const result = await response.json();
            
            if (result.success && result.stats && this.authState?.user) {
                // Mettre à jour les stats dans l'état local
                this.authState.user.finds_count = result.stats.finds_count;
                this.authState.user.hides_count = result.stats.hides_count;
                this.authState.user.favorite_points = result.stats.favorite_points;
                this.authState.user.awarded_favorite_points = result.stats.awarded_favorite_points;
                this.authState.user.stats_last_updated = result.stats.stats_last_updated;
            } else {
                this.error = result.error_message || 'Impossible de rafraîchir les statistiques';
            }
        } catch (err) {
            this.error = 'Erreur lors du rafraîchissement des stats';
            console.error('Refresh stats failed:', err);
        } finally {
            this.loading = false;
            this.update();
        }
    }

    protected async fetchProfileStatsQuietly(): Promise<void> {
        // Récupère les stats en arrière-plan sans bloquer l'UI
        console.log('[GeocachingAuth] fetchProfileStatsQuietly called');
        try {
            const baseUrl = this.getApiBaseUrl();
            const url = `${baseUrl}/api/auth/profile?force=true`;
            console.log('[GeocachingAuth] Fetching profile stats from:', url);
            const response = await fetch(url);
            const result = await response.json();
            console.log('[GeocachingAuth] Profile stats response:', result);
            
            if (result.success && result.stats && this.authState?.user) {
                console.log('[GeocachingAuth] Updating user stats:', result.stats);
                this.authState.user.finds_count = result.stats.finds_count;
                this.authState.user.hides_count = result.stats.hides_count;
                this.authState.user.favorite_points = result.stats.favorite_points;
                this.authState.user.awarded_favorite_points = result.stats.awarded_favorite_points;
                this.authState.user.stats_last_updated = result.stats.stats_last_updated;
                this.update();
                console.log('[GeocachingAuth] Stats updated and UI refreshed');
            } else {
                console.log('[GeocachingAuth] Stats not updated - success:', result.success, 'stats:', !!result.stats, 'user:', !!this.authState?.user);
            }
        } catch (err) {
            console.error('[GeocachingAuth] Background fetch stats failed:', err);
        }
    }

    protected render(): React.ReactNode {
        return (
            <div className="geocaching-auth-container" style={{ padding: '16px', maxWidth: '500px' }}>
                <h2 style={{ marginTop: 0, marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span className="codicon codicon-key"></span>
                    Connexion Geocaching.com
                </h2>

                {this.renderStatus()}
                
                {this.error && (
                    <div style={{
                        padding: '12px',
                        marginBottom: '16px',
                        backgroundColor: 'var(--theia-inputValidation-errorBackground)',
                        border: '1px solid var(--theia-inputValidation-errorBorder)',
                        borderRadius: '4px',
                        color: 'var(--theia-errorForeground)'
                    }}>
                        {this.error}
                    </div>
                )}

                {this.authState?.status === 'logged_in' 
                    ? this.renderLoggedInView()
                    : this.renderLoginForm()
                }
            </div>
        );
    }

    protected renderStatus(): React.ReactNode {
        if (!this.authState) {
            return (
                <div style={{ marginBottom: '16px', color: 'var(--theia-descriptionForeground)' }}>
                    Chargement du statut...
                </div>
            );
        }

        const statusMap: Record<string, { label: string; color: string; icon: string }> = {
            'logged_in': { label: 'Connecté', color: 'var(--theia-successBackground)', icon: 'codicon-check' },
            'logged_out': { label: 'Déconnecté', color: 'var(--theia-inputValidation-warningBackground)', icon: 'codicon-circle-slash' },
            'not_configured': { label: 'Non configuré', color: 'var(--theia-inputValidation-warningBackground)', icon: 'codicon-warning' },
            'login_failed': { label: 'Échec de connexion', color: 'var(--theia-inputValidation-errorBackground)', icon: 'codicon-error' },
            'captcha_required': { label: 'Captcha requis', color: 'var(--theia-inputValidation-errorBackground)', icon: 'codicon-shield' },
            'account_not_validated': { label: 'Compte non validé', color: 'var(--theia-inputValidation-errorBackground)', icon: 'codicon-mail' },
        };

        const status = statusMap[this.authState.status] || { label: this.authState.status, color: 'var(--theia-editor-background)', icon: 'codicon-question' };

        return (
            <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                padding: '12px',
                marginBottom: '16px',
                backgroundColor: status.color,
                borderRadius: '4px'
            }}>
                <span className={`codicon ${status.icon}`}></span>
                <span style={{ fontWeight: 'bold' }}>{status.label}</span>
                {this.authState.method !== 'none' && (
                    <span style={{ marginLeft: 'auto', fontSize: '0.9em', opacity: 0.8 }}>
                        via {this.authState.method === 'credentials' ? 'identifiants' : 'cookies navigateur'}
                    </span>
                )}
            </div>
        );
    }

    protected renderLoggedInView(): React.ReactNode {
        const user = this.authState?.user;
        
        return (
            <div>
                {user && (
                    <div style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '12px',
                        padding: '16px',
                        marginBottom: '16px',
                        backgroundColor: 'var(--theia-editor-background)',
                        borderRadius: '4px',
                        border: '1px solid var(--theia-panel-border)'
                    }}>
                        {user.avatar_url && (
                            <img 
                                src={user.avatar_url} 
                                alt="Avatar" 
                                style={{ width: '48px', height: '48px', borderRadius: '50%' }}
                            />
                        )}
                        <div style={{ flex: 1 }}>
                            <div style={{ fontWeight: 'bold', fontSize: '1.1em' }}>{user.username}</div>
                            {user.user_type && (
                                <div style={{ 
                                    fontSize: '0.9em', 
                                    color: user.user_type === 'Premium' ? 'var(--theia-notificationsInfoIcon-foreground)' : 'var(--theia-descriptionForeground)'
                                }}>
                                    {user.user_type}
                                </div>
                            )}
                        </div>
                    </div>
                )}

                {/* Statistiques du profil */}
                {user && this.renderProfileStats(user)}

                <div style={{ display: 'flex', gap: '8px' }}>
                    <button
                        className="theia-button"
                        onClick={() => this.refreshProfileStats()}
                        disabled={this.loading}
                        style={{ flex: 1 }}
                    >
                        <span className="codicon codicon-refresh"></span>
                        {this.loading ? ' Rafraîchissement...' : ' Rafraîchir les stats'}
                    </button>
                    <button
                        className="theia-button secondary"
                        onClick={() => this.logout()}
                        disabled={this.loading}
                    >
                        <span className="codicon codicon-sign-out"></span>
                        {' Déconnexion'}
                    </button>
                </div>
            </div>
        );
    }

    protected renderProfileStats(user: any): React.ReactNode {

        const stats = [
            { 
                icon: 'codicon-search', 
                label: 'Trouvées', 
                value: user.finds_count, 
                color: 'var(--theia-charts-green)' 
            },
            { 
                icon: 'codicon-heart', 
                label: 'PF disponibles', 
                value: user.awarded_favorite_points, 
                color: 'var(--theia-charts-red)',
                highlight: true
            },
        ];

        return (
            <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(2, 1fr)',
                gap: '12px',
                marginBottom: '16px'
            }}>
                {stats.map((stat, index) => (
                    <div 
                        key={index}
                        style={{
                            padding: '12px',
                            backgroundColor: 'var(--theia-editor-background)',
                            borderRadius: '4px',
                            border: stat.highlight 
                                ? '2px solid var(--theia-focusBorder)' 
                                : '1px solid var(--theia-panel-border)',
                            textAlign: 'center'
                        }}
                    >
                        <div style={{ 
                            display: 'flex', 
                            alignItems: 'center', 
                            justifyContent: 'center',
                            gap: '4px',
                            marginBottom: '4px',
                            color: 'var(--theia-descriptionForeground)',
                            fontSize: '0.85em'
                        }}>
                            <span className={`codicon ${stat.icon}`} style={{ color: stat.color }}></span>
                            {stat.label}
                        </div>
                        <div style={{ 
                            fontSize: '1.4em', 
                            fontWeight: 'bold',
                            color: stat.value !== undefined && stat.value !== null 
                                ? 'var(--theia-foreground)' 
                                : 'var(--theia-descriptionForeground)'
                        }}>
                            {stat.value !== undefined && stat.value !== null ? stat.value : '—'}
                        </div>
                    </div>
                ))}
            </div>
        );
    }

    protected renderLoginForm(): React.ReactNode {
        return (
            <div>
                {/* Method selector */}
                <div style={{ marginBottom: '16px' }}>
                    <label style={{ display: 'block', marginBottom: '8px', fontWeight: 'bold' }}>
                        Méthode de connexion
                    </label>
                    <div style={{ display: 'flex', gap: '8px' }}>
                        <button
                            className={`theia-button ${this.selectedMethod === 'credentials' ? '' : 'secondary'}`}
                            onClick={() => { this.selectedMethod = 'credentials'; this.update(); }}
                            style={{ flex: 1 }}
                        >
                            <span className="codicon codicon-account"></span>
                            {' Identifiants'}
                        </button>
                        <button
                            className={`theia-button ${this.selectedMethod === 'browser_cookies' ? '' : 'secondary'}`}
                            onClick={() => { this.selectedMethod = 'browser_cookies'; this.update(); }}
                            style={{ flex: 1 }}
                        >
                            <span className="codicon codicon-browser"></span>
                            {' Cookies navigateur'}
                        </button>
                    </div>
                </div>

                {this.selectedMethod === 'credentials' 
                    ? this.renderCredentialsForm()
                    : this.renderBrowserCookiesForm()
                }
            </div>
        );
    }

    protected renderCredentialsForm(): React.ReactNode {
        return (
            <div>
                <p style={{ color: 'var(--theia-descriptionForeground)', marginBottom: '16px' }}>
                    Connectez-vous avec votre nom d'utilisateur ou email Geocaching.com et votre mot de passe.
                    Cette méthode est recommandée car elle est indépendante de votre navigateur.
                </p>

                <div style={{ marginBottom: '12px' }}>
                    <label style={{ display: 'block', marginBottom: '4px' }}>
                        Nom d'utilisateur ou email
                    </label>
                    <input
                        type="text"
                        className="theia-input"
                        value={this.username}
                        onChange={(e) => { this.username = e.target.value; this.update(); }}
                        placeholder="mon_pseudo ou email@example.com"
                        style={{ width: '100%' }}
                        disabled={this.loading}
                    />
                </div>

                <div style={{ marginBottom: '12px' }}>
                    <label style={{ display: 'block', marginBottom: '4px' }}>
                        Mot de passe
                    </label>
                    <input
                        type="password"
                        className="theia-input"
                        value={this.password}
                        onChange={(e) => { this.password = e.target.value; this.update(); }}
                        placeholder="••••••••"
                        style={{ width: '100%' }}
                        disabled={this.loading}
                        onKeyPress={(e) => { if (e.key === 'Enter') this.loginWithCredentials(); }}
                    />
                </div>

                <div style={{ marginBottom: '16px' }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                        <input
                            type="checkbox"
                            checked={this.rememberCredentials}
                            onChange={(e) => { this.rememberCredentials = e.target.checked; this.update(); }}
                            disabled={this.loading}
                        />
                        Mémoriser les identifiants
                    </label>
                </div>

                <button
                    className="theia-button"
                    onClick={() => this.loginWithCredentials()}
                    disabled={this.loading || !this.username || !this.password}
                    style={{ width: '100%' }}
                >
                    <span className="codicon codicon-sign-in"></span>
                    {this.loading ? ' Connexion en cours...' : ' Se connecter'}
                </button>

                <div style={{ 
                    marginTop: '16px', 
                    padding: '12px', 
                    backgroundColor: 'var(--theia-inputValidation-infoBackground)',
                    borderRadius: '4px',
                    fontSize: '0.9em'
                }}>
                    <strong>Note :</strong> Si vous avez créé votre compte via Google/Apple/Facebook, 
                    vous devez d'abord définir un mot de passe sur geocaching.com ou utiliser la méthode 
                    "Cookies navigateur".
                </div>
            </div>
        );
    }

    protected renderBrowserCookiesForm(): React.ReactNode {
        return (
            <div>
                <p style={{ color: 'var(--theia-descriptionForeground)', marginBottom: '16px' }}>
                    Cette méthode extrait les cookies de session depuis votre navigateur.
                    Vous devez être connecté à Geocaching.com dans le navigateur sélectionné.
                </p>

                <div style={{ marginBottom: '16px' }}>
                    <label style={{ display: 'block', marginBottom: '4px' }}>
                        Navigateur source
                    </label>
                    <select
                        className="theia-input"
                        value={this.selectedBrowser}
                        onChange={(e) => { this.selectedBrowser = e.target.value as typeof this.selectedBrowser; this.update(); }}
                        style={{ width: '100%' }}
                        disabled={this.loading}
                    >
                        <option value="auto">Automatique (Firefox → Chrome → Edge)</option>
                        <option value="firefox">Firefox</option>
                        <option value="chrome">Chrome</option>
                        <option value="edge">Edge</option>
                    </select>
                </div>

                <button
                    className="theia-button"
                    onClick={() => this.loginWithBrowser()}
                    disabled={this.loading}
                    style={{ width: '100%' }}
                >
                    <span className="codicon codicon-browser"></span>
                    {this.loading ? ' Extraction en cours...' : ' Utiliser les cookies du navigateur'}
                </button>

                <div style={{ 
                    marginTop: '16px', 
                    padding: '12px', 
                    backgroundColor: 'var(--theia-inputValidation-warningBackground)',
                    borderRadius: '4px',
                    fontSize: '0.9em'
                }}>
                    <strong>Attention :</strong> Cette méthode nécessite de garder le navigateur connecté.
                    Si vous vous déconnectez du navigateur ou si les cookies expirent, vous devrez 
                    recommencer cette procédure.
                </div>
            </div>
        );
    }
}
