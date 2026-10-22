export const legacyWorkflowConfig=Object.freeze({parallelPlanning:false,reviewEnabled:false,maxRounds:1,forceRevisionDemo:false,agentPrompts:Object.freeze({})});

// A saved run owns its execution plan. Editing the next run must not change it.
export function executionConfig(state,draft){
 const hasRun=!!state?.id||Object.keys(state?.outputs||{}).length>0;
 return hasRun?(state.config||legacyWorkflowConfig):draft;
}
export function needsBackendRestart(config){return !config?.workflow||!config?.providers;}
