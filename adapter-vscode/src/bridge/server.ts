export interface BridgeServerHandlers {
  userPromptSubmit: (payload: unknown) => Promise<unknown>;
  preToolUse: (payload: unknown) => Promise<unknown>;
  postToolUse: (payload: unknown) => Promise<unknown>;
}

export interface CreateBridgeServerOptions {
  token: string;
  handlers: BridgeServerHandlers;
}

export interface BridgeServer {
  handle(hookEventName: string, payload: unknown): Promise<unknown>;
}

export function createBridgeServer(options: CreateBridgeServerOptions): BridgeServer {
  const { token, handlers } = options;

  return {
    async handle(hookEventName: string, payload: unknown): Promise<unknown> {
      const authorizedPayload = authorizePayload(hookEventName, payload, token);

      switch (hookEventName) {
        case 'UserPromptSubmit':
          return callHandler(hookEventName, () => handlers.userPromptSubmit(authorizedPayload));
        case 'PreToolUse':
          return callHandler(hookEventName, () => handlers.preToolUse(authorizedPayload));
        case 'PostToolUse':
          return callHandler(hookEventName, () => handlers.postToolUse(authorizedPayload));
        default:
          throw new Error(`unsupported hook event: ${hookEventName}`);
      }
    },
  };
}

function authorizePayload(hookEventName: string, payload: unknown, expectedToken: string): unknown {
  if (typeof payload !== 'object' || payload === null) {
    throw new Error(`invalid bridge payload for event ${hookEventName}`);
  }

  const tokenValue = (payload as Record<string, unknown>).token;
  if (tokenValue !== expectedToken) {
    throw new Error(`invalid bridge token for event ${hookEventName}`);
  }

  const { token: _token, ...rest } = payload as Record<string, unknown>;
  return rest;
}

async function callHandler(hookEventName: string, handler: () => Promise<unknown>): Promise<unknown> {
  try {
    return await handler();
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`bridge handler failed for event ${hookEventName}: ${message}`);
  }
}
