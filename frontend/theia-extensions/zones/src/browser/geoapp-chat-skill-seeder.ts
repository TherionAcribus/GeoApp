import { injectable, inject } from '@theia/core/shared/inversify';
import { FrontendApplicationContribution } from '@theia/core/lib/browser';
import { EnvVariablesServer } from '@theia/core/lib/common/env-variables';
import { URI } from '@theia/core';
import { BinaryBuffer } from '@theia/core/lib/common/buffer';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import { SkillService } from '@theia/ai-core/lib/browser';

import { GeoAppChatSkills, isGeoAppManagedSkillContent } from './geoapp-chat-skills';

@injectable()
export class GeoAppChatSkillSeeder implements FrontendApplicationContribution {

    @inject(EnvVariablesServer)
    protected readonly envVariablesServer!: EnvVariablesServer;

    @inject(FileService)
    protected readonly fileService!: FileService;

    @inject(SkillService)
    protected readonly skillService!: SkillService;

    async onStart(): Promise<void> {
        try {
            await this.seedSkills();
            void this.skillService.ready
                .then(() => this.refreshSkillService())
                .catch(error => console.warn('[GeoAppChatSkillSeeder] Failed to refresh skill service', error));
        } catch (error) {
            console.warn('[GeoAppChatSkillSeeder] Failed to seed GeoApp chat skills', error);
        }
    }

    protected async seedSkills(): Promise<void> {
        const configDirUri = await this.envVariablesServer.getConfigDirUri();
        const skillsDir = new URI(configDirUri).resolve('skills');

        for (const skill of GeoAppChatSkills) {
            const skillFileUri = skillsDir.resolve(skill.name).resolve('SKILL.md');
            const existingContent = await this.readExistingContent(skillFileUri);
            if (existingContent !== undefined && !isGeoAppManagedSkillContent(existingContent)) {
                continue;
            }
            if (existingContent === skill.content) {
                continue;
            }
            await this.fileService.writeFile(skillFileUri, BinaryBuffer.fromString(skill.content));
        }
    }

    protected async refreshSkillService(): Promise<void> {
        const refreshable = this.skillService as unknown as { update?: () => Promise<void> };
        if (typeof refreshable.update === 'function') {
            await refreshable.update.call(this.skillService);
        }
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
}
