import { createHash, randomBytes, randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import type { FastifyReply, FastifyRequest } from "fastify";

import { db } from "./db/index.js";
import { anonymousSessions } from "./db/schema.js";
import { DAY_MS, env } from "./env.js";

const COOKIE_NAME = "ion_canvas_sid";
const COOKIE_MAX_AGE_SECONDS = env.sessionDays * 24 * 60 * 60;

declare module "fastify" {
    interface FastifyRequest {
        anonymousSessionId: string;
    }
}

function tokenHash(token: string) {
    return createHash("sha256").update(token).digest("hex");
}

function writeCookie(reply: FastifyReply, token: string) {
    reply.setCookie(COOKIE_NAME, token, {
        httpOnly: true,
        secure: env.cookieSecure,
        sameSite: "strict",
        path: "/",
        maxAge: COOKIE_MAX_AGE_SECONDS,
    });
}

export function attachAnonymousSession(request: FastifyRequest, reply: FastifyReply) {
    const now = Date.now();
    const token = request.cookies[COOKIE_NAME];
    if (token) {
        const session = db.select().from(anonymousSessions).where(eq(anonymousSessions.tokenHash, tokenHash(token))).get();
        if (session && session.expiresAt > now) {
            request.anonymousSessionId = session.id;
            db.update(anonymousSessions)
                .set({ lastSeenAt: now, expiresAt: now + env.sessionDays * DAY_MS })
                .where(eq(anonymousSessions.id, session.id))
                .run();
            writeCookie(reply, token);
            return;
        }
    }

    const nextToken = randomBytes(32).toString("base64url");
    const id = randomUUID();
    db.insert(anonymousSessions)
        .values({ id, tokenHash: tokenHash(nextToken), createdAt: now, lastSeenAt: now, expiresAt: now + env.sessionDays * DAY_MS })
        .run();
    request.anonymousSessionId = id;
    writeCookie(reply, nextToken);
}
