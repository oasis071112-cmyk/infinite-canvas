import { env } from "./env.js";
import { ApiError } from "./errors.js";

let globalActive = 0;
const sessionActive = new Map<string, number>();
const ipActive = new Map<string, number>();

export function acquireAiSlot(sessionId: string, ip: string) {
    const activeSession = sessionActive.get(sessionId) || 0;
    const activeIp = ipActive.get(ip) || 0;
    if (activeSession >= env.sessionConcurrency) throw new ApiError(429, "SESSION_CONCURRENCY_LIMIT", "当前浏览器同时进行的生成任务过多，请稍后重试");
    if (activeIp >= env.ipConcurrency) throw new ApiError(429, "IP_CONCURRENCY_LIMIT", "当前网络同时进行的生成任务过多，请稍后重试");
    if (globalActive >= env.globalConcurrency) throw new ApiError(503, "SERVER_CONCURRENCY_LIMIT", "服务器当前生成任务较多，请稍后重试");
    globalActive += 1;
    sessionActive.set(sessionId, activeSession + 1);
    ipActive.set(ip, activeIp + 1);
    let released = false;
    return () => {
        if (released) return;
        released = true;
        globalActive = Math.max(0, globalActive - 1);
        const next = Math.max(0, (sessionActive.get(sessionId) || 1) - 1);
        if (next) sessionActive.set(sessionId, next);
        else sessionActive.delete(sessionId);
        const nextIp = Math.max(0, (ipActive.get(ip) || 1) - 1);
        if (nextIp) ipActive.set(ip, nextIp);
        else ipActive.delete(ip);
    };
}
