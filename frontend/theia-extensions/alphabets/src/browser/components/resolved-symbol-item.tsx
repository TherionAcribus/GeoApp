import * as React from '@theia/core/shared/react';
import { AlphabetConfig } from '../../common/alphabet-protocol';
import { resolveAlphabetImageSource, resolveAlphabetImageSourceSync } from '../alphabet-symbol-resolver';
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
    const char = symbolProps.char;

    // Résolution synchrone (cache / manifeste) : renvoie l'URL ou null quand elle
    // est déterminée sans réseau, sinon undefined (probing asynchrone nécessaire).
    const syncResolved = React.useMemo(() => {
        if (alphabetConfig.type !== 'images') {
            return null;
        }
        return resolveAlphabetImageSourceSync(alphabetId, alphabetConfig, char, alphabetsService);
    }, [alphabetId, alphabetConfig, alphabetsService, char]);

    const [asyncResolved, setAsyncResolved] = React.useState<string | undefined>(undefined);

    React.useEffect(() => {
        let cancelled = false;

        // Rien à faire si le résultat est déjà connu de manière synchrone.
        if (alphabetConfig.type !== 'images' || syncResolved !== undefined) {
            setAsyncResolved(undefined);
            return () => {
                cancelled = true;
            };
        }

        void resolveAlphabetImageSource(alphabetId, alphabetConfig, char, alphabetsService)
            .then(resolvedSource => {
                if (!cancelled) {
                    setAsyncResolved(resolvedSource || undefined);
                }
            });

        return () => {
            cancelled = true;
        };
    }, [alphabetId, alphabetConfig, alphabetsService, char, syncResolved]);

    const imagePath = alphabetConfig.type === 'images'
        ? (syncResolved !== undefined ? (syncResolved ?? undefined) : asyncResolved)
        : undefined;

    return <SymbolItem {...symbolProps} imagePath={imagePath} />;
};
