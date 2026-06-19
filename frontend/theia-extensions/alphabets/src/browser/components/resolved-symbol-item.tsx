import * as React from '@theia/core/shared/react';
import { AlphabetConfig } from '../../common/alphabet-protocol';
import { resolveAlphabetImageSource } from '../alphabet-symbol-resolver';
import { AlphabetsService } from '../services/alphabets-service';
import { SymbolItem, SymbolItemProps } from './symbol-item';

export interface ResolvedSymbolItemProps extends Omit<SymbolItemProps, 'imagePath'> {
    alphabetId: string;
    alphabetConfig: AlphabetConfig;
    alphabetsService: AlphabetsService;
}

export const ResolvedSymbolItem: React.FC<ResolvedSymbolItemProps> = ({
    alphabetId,
    alphabetConfig,
    alphabetsService,
    ...symbolProps
}) => {
    const [imagePath, setImagePath] = React.useState<string | undefined>(undefined);

    React.useEffect(() => {
        let cancelled = false;

        if (alphabetConfig.type !== 'images') {
            setImagePath(undefined);
            return () => {
                cancelled = true;
            };
        }

        void resolveAlphabetImageSource(alphabetId, alphabetConfig, symbolProps.char, alphabetsService)
            .then(resolvedSource => {
                if (!cancelled) {
                    setImagePath(resolvedSource || undefined);
                }
            });

        return () => {
            cancelled = true;
        };
    }, [alphabetId, alphabetConfig, alphabetsService, symbolProps.char]);

    return <SymbolItem {...symbolProps} imagePath={imagePath} />;
};
