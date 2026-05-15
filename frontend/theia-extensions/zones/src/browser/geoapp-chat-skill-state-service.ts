import { injectable, inject } from '@theia/core/shared/inversify';
import { URI } from '@theia/core';
import { BinaryBuffer } from '@theia/core/lib/common/buffer';
import { EnvVariablesServer } from '@theia/core/lib/common/env-variables';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import { SkillService } from '@theia/ai-core/lib/browser/skill-service';

import { GeoAppChatSkillMetadata, GeoAppChatSkills, isGeoAppManagedSkillContent } from './geoapp-chat-skills';

export type GeoAppChatSkillStateKind =
    'geoapp_default'
    | 'customized'
    | 'outdated'
    | 'missing'
    | 'not_discovered'
    | 'unreadable';

export interface GeoAppChatSkillState {
    name: string;
    status: GeoAppChatSkillStateKind;
    location?: string;
    configLocation: string;
    discovered: boolean;
    managedContent: boolean;
    message: string;
}

@injectable()
export class GeoAppChatSkillStateService {

    @inject(EnvVariablesServer)
    protected readonly envVariablesServer!: EnvVariablesServer;

    @inject(FileService)
    protected readonly fileService!: FileService;

    @inject(SkillService)
    protected readonly skillService!: SkillService;

    async getSkillStates(): Promise<Map<string, GeoAppChatSkillState>> {
        const states = new Map<string, GeoAppChatSkillState>();
        for (const skill of GeoAppChatSkills) {
            states.set(skill.name, await this.getSkillState(skill));
        }
        return states;
    }

    async restoreGeoAppSkill(skillName: string): Promise<GeoAppChatSkillState | undefined> {
        const skill = GeoAppChatSkills.find(candidate => candidate.name === skillName);
        if (!skill) {
            return undefined;
        }
        const discoveredSkill = this.skillService.getSkill(skill.name);
        const skillFileUri = discoveredSkill ? URI.fromFilePath(discoveredSkill.location) : await this.getConfigSkillFileUri(skill.name);
        await this.fileService.writeFile(skillFileUri, BinaryBuffer.fromString(skill.content));
        await this.refreshSkillService();
        return this.getSkillState(skill);
    }

    protected async getSkillState(skill: GeoAppChatSkillMetadata): Promise<GeoAppChatSkillState> {
        const configSkillFileUri = await this.getConfigSkillFileUri(skill.name);
        const configLocation = configSkillFileUri.path.fsPath();
        const discoveredSkill = this.skillService.getSkill(skill.name);
        if (!discoveredSkill) {
            const configContent = await this.readExistingContent(configSkillFileUri);
            if (configContent === undefined) {
                return {
                    name: skill.name,
                    status: 'missing',
                    configLocation,
                    discovered: false,
                    managedContent: false,
                    message: 'Skill absente. GeoApp peut la restaurer dans le dossier de configuration.',
                };
            }
            return {
                name: skill.name,
                status: 'not_discovered',
                configLocation,
                discovered: false,
                managedContent: isGeoAppManagedSkillContent(configContent),
                message: 'Skill présente sur disque mais pas encore découverte par Theia. Un refresh ou redémarrage peut être nécessaire.',
            };
        }

        const location = discoveredSkill.location;
        const content = await this.readExistingContent(URI.fromFilePath(location));
        if (content === undefined) {
            return {
                name: skill.name,
                status: 'unreadable',
                location,
                configLocation,
                discovered: true,
                managedContent: false,
                message: 'Skill découverte par Theia, mais son fichier ne peut pas être lu.',
            };
        }

        if (content === skill.content) {
            return {
                name: skill.name,
                status: 'geoapp_default',
                location,
                configLocation,
                discovered: true,
                managedContent: true,
                message: 'Version GeoApp active.',
            };
        }

        if (isGeoAppManagedSkillContent(content)) {
            return {
                name: skill.name,
                status: 'outdated',
                location,
                configLocation,
                discovered: true,
                managedContent: true,
                message: 'Skill GeoApp gérée, mais différente de la version actuelle intégrée.',
            };
        }

        return {
            name: skill.name,
            status: 'customized',
            location,
            configLocation,
            discovered: true,
            managedContent: false,
            message: 'Skill personnalisée par l’utilisateur. GeoApp ne l’écrase pas automatiquement.',
        };
    }

    protected async getConfigSkillFileUri(skillName: string): Promise<URI> {
        const configDirUri = await this.envVariablesServer.getConfigDirUri();
        return new URI(configDirUri).resolve('skills').resolve(skillName).resolve('SKILL.md');
    }

    protected async readExistingContent(uri: URI): Promise<string | undefined> {
        try {
            if (!await this.fileService.exists(uri)) {
                return undefined;
            }
            return (await this.fileService.read(uri)).value;
        } catch {
            return undefined;
        }
    }

    protected async refreshSkillService(): Promise<void> {
        const refreshable = this.skillService as unknown as { update?: () => Promise<void> };
        if (typeof refreshable.update === 'function') {
            await refreshable.update.call(this.skillService);
        }
    }
}
