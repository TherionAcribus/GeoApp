/**
 * Module frontend Formula Solver
 * Point d'entrée de l'extension Theia
 */

import { ContainerModule } from '@theia/core/shared/inversify';
import { FormulaSolverWidget } from './formula-solver-widget';
import { FormulaSolverContribution } from './formula-solver-contribution';
import { FormulaSolverService, FormulaSolverServiceImpl } from './formula-solver-service';
import { FormulaSolverAIService, FormulaSolverAIServiceImpl } from './formula-solver-ai-service';
import { FormulaSolverLLMService } from './formula-solver-llm-service';
import { GeoAppFormulaSolverAgentsContribution } from './geoapp-formula-solver-agents';
import { FormulaSolverPipeline } from './formula-solver-pipeline';
import { AnsweringContextCache } from './answering-context-cache';
import { AlgorithmFormulaDetector } from './strategies/algorithm-formula-detector';
import { AiFormulaDetector } from './strategies/ai-formula-detector';
import { NoneQuestionDiscovery } from './strategies/none-question-discovery';
import { AlgorithmQuestionDiscovery } from './strategies/algorithm-question-discovery';
import { AiQuestionDiscovery } from './strategies/ai-question-discovery';
import { AiBulkAnswering } from './strategies/ai-bulk-answering';
import { AiPerQuestionAnswering } from './strategies/ai-per-question-answering';
import { BackendWebSearchAnswering } from './strategies/backend-web-search-answering';
import { FrontendApplicationContribution, WidgetFactory } from '@theia/core/lib/browser';
import { CommandContribution, MenuContribution } from '@theia/core/lib/common';
import { TabBarToolbarContribution } from '@theia/core/lib/browser/shell/tab-bar-toolbar';

console.log('[FORMULA-SOLVER] Loading formula-solver-frontend-module...');

export default new ContainerModule(bind => {
    console.log('[FORMULA-SOLVER] Registering services and contributions...');

    // Ne pas créer MapService ici - il sera injecté depuis zones si disponible
    // L'injection @optional() dans FormulaSolverWidget gérera l'absence

    // Service principal
    bind(FormulaSolverService).to(FormulaSolverServiceImpl).inSingletonScope();
    
    // Service IA
    bind(FormulaSolverAIService).to(FormulaSolverAIServiceImpl).inSingletonScope();

    // Service LLM pour les appels IA directs
    bind(FormulaSolverLLMService).toSelf().inSingletonScope();

    // Cache du contexte IA pour réponses (réutilisé par question / bulk)
    bind(AnsweringContextCache).toSelf().inSingletonScope();

    // Pipeline & stratégies (modulaires / rejouables)
    bind(AlgorithmFormulaDetector).toSelf().inSingletonScope();
    bind(AiFormulaDetector).toSelf().inSingletonScope();
    bind(NoneQuestionDiscovery).toSelf().inSingletonScope();
    bind(AlgorithmQuestionDiscovery).toSelf().inSingletonScope();
    bind(AiQuestionDiscovery).toSelf().inSingletonScope();
    bind(AiBulkAnswering).toSelf().inSingletonScope();
    bind(AiPerQuestionAnswering).toSelf().inSingletonScope();
    bind(BackendWebSearchAnswering).toSelf().inSingletonScope();
    bind(FormulaSolverPipeline).toSelf().inSingletonScope();
    
    // Widget
    bind(FormulaSolverWidget).toSelf().inSingletonScope();
    bind(WidgetFactory).toDynamicValue(ctx => ({
        id: FormulaSolverWidget.ID,
        createWidget: () => ctx.container.get<FormulaSolverWidget>(FormulaSolverWidget)
    })).inSingletonScope();

    // Contribution
    bind(FormulaSolverContribution).toSelf().inSingletonScope();
    bind(FrontendApplicationContribution).toService(FormulaSolverContribution);
    bind(CommandContribution).toService(FormulaSolverContribution);
    bind(MenuContribution).toService(FormulaSolverContribution);
    bind(TabBarToolbarContribution).toService(FormulaSolverContribution);

    // Agents IA (fast/strong/web) configurables comme OCR
    bind(GeoAppFormulaSolverAgentsContribution).toSelf().inSingletonScope();
    bind(FrontendApplicationContribution).toService(GeoAppFormulaSolverAgentsContribution);

    console.log('[FORMULA-SOLVER] Formula Solver Extension (with AI) registered successfully');
});
