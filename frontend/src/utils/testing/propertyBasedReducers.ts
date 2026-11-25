// Highly secure Property-based Testing for State Reducers

export interface Action {
  type: string;
  payload?: any;
}

export type Reducer<T> = (state: T, action: Action) => T;

export interface PropertyTestConfig<T> {
  numIterations?: number;
  seedState: T;
  actionGenerators: Array<() => Action>;
  invariants: Array<(state: T) => boolean>;
  onError?: (error: Error, state: T, action: Action) => void;
}

/**
 * Executes property-based testing on a state reducer to ensure invariants hold
 * across many random actions.
 */
export function runPropertyBasedTests<T>(
  reducer: Reducer<T>,
  config: PropertyTestConfig<T>
): { success: boolean; errors: string[] } {
  const { 
    numIterations = 1000, 
    seedState, 
    actionGenerators, 
    invariants,
    onError 
  } = config;

  let currentState = seedState;
  const errors: string[] = [];

  for (let i = 0; i < numIterations; i++) {
    // Pick a random action generator
    const genIndex = Math.floor(Math.random() * actionGenerators.length);
    const action = actionGenerators[genIndex]();

    try {
      currentState = reducer(currentState, action);

      // Check invariants
      invariants.forEach((invariant, invIndex) => {
        if (!invariant(currentState)) {
          const errMsg = `Invariant ${invIndex} failed after action ${action.type}`;
          errors.push(errMsg);
          if (onError) onError(new Error(errMsg), currentState, action);
        }
      });
    } catch (err: any) {
      const errMsg = `Reducer threw error on action ${action.type}: ${err.message}`;
      errors.push(errMsg);
      if (onError) onError(err, currentState, action);
      
      // Fallback system - reset to seed on fatal error
      currentState = seedState; 
    }

    if (errors.length > 50) {
      // Short-circuit if too many failures
      errors.push("Aborted early due to excessive failures.");
      break;
    }
  }

  return {
    success: errors.length === 0,
    errors
  };
}

// Example usage / Export for testing
export const assertReducerInvariants = <T>(
  reducer: Reducer<T>,
  config: PropertyTestConfig<T>
) => {
  const result = runPropertyBasedTests(reducer, config);
  if (!result.success) {
    console.error("Property-based testing failed:", result.errors);
  }
  return result;
};
