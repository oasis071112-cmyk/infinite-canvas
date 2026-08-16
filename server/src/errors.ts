export class ApiError extends Error {
    constructor(
        public readonly statusCode: number,
        public readonly code: string,
        message: string,
    ) {
        super(message);
    }
}

export function errorCode(error: unknown) {
    if (error instanceof ApiError) return error.code;
    if (error instanceof Error && error.name === "TimeoutError") return "UPSTREAM_TIMEOUT";
    if (error instanceof Error && error.name === "AbortError") return "REQUEST_ABORTED";
    return "UPSTREAM_REQUEST_FAILED";
}
