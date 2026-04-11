export function assertUserPromptSubmitPayload(payload) {
    if (typeof payload !== 'object' || payload === null) {
        throw new Error('invalid UserPromptSubmit payload');
    }
    const p = payload;
    if (typeof p.session_id !== 'string' ||
        typeof p.prompt !== 'string' ||
        typeof p.cwd !== 'string' ||
        typeof p.timestamp !== 'string' ||
        (p.transcript_path !== undefined && typeof p.transcript_path !== 'string')) {
        throw new Error('invalid UserPromptSubmit payload');
    }
    return {
        session_id: p.session_id,
        prompt: p.prompt,
        cwd: p.cwd,
        transcript_path: typeof p.transcript_path === 'string' ? p.transcript_path : undefined,
        timestamp: p.timestamp,
    };
}
export function assertPreToolUsePayload(payload) {
    if (typeof payload !== 'object' || payload === null) {
        throw new Error('invalid PreToolUse payload');
    }
    const p = payload;
    if (typeof p.session_id !== 'string' ||
        typeof p.tool_name !== 'string' ||
        typeof p.tool_use_id !== 'string' ||
        typeof p.cwd !== 'string' ||
        typeof p.timestamp !== 'string' ||
        typeof p.tool_input !== 'object' ||
        p.tool_input === null ||
        Array.isArray(p.tool_input)) {
        throw new Error('invalid PreToolUse payload');
    }
    return {
        session_id: p.session_id,
        tool_name: p.tool_name,
        tool_use_id: p.tool_use_id,
        cwd: p.cwd,
        timestamp: p.timestamp,
        tool_input: p.tool_input,
        transcript_path: typeof p.transcript_path === 'string' ? p.transcript_path : undefined,
    };
}
export function assertPostToolUsePayload(payload) {
    if (typeof payload !== 'object' || payload === null) {
        throw new Error('invalid PostToolUse payload');
    }
    const p = payload;
    if (typeof p.session_id !== 'string' ||
        typeof p.tool_name !== 'string' ||
        typeof p.tool_use_id !== 'string' ||
        typeof p.cwd !== 'string' ||
        typeof p.timestamp !== 'string') {
        throw new Error('invalid PostToolUse payload');
    }
    return {
        session_id: p.session_id,
        tool_name: p.tool_name,
        tool_use_id: p.tool_use_id,
        cwd: p.cwd,
        timestamp: p.timestamp,
        tool_response: p.tool_response,
    };
}
