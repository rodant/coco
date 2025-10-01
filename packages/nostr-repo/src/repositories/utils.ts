/**
 * Normalize a mint URL to a canonical, stable representation:
 * - Only http/https are accepted
 * - Lowercase scheme and host
 * - Strip username/password, query and fragment
 * - Strip default ports (http:80, https:443)
 * - Normalize path:
 *   - "/" for root
 *   - no trailing slash for non-root
 *
 * Throws on invalid URLs or unsupported protocols.
 */
export function normalizeMintUrl(input: string): string {
    let u: URL;
    try {
        u = new URL(input);
    } catch {
        throw new Error(`Invalid mint URL: ${input}`);
    }

    if (u.protocol !== "http:" && u.protocol !== "https:") {
        throw new Error(`Unsupported mint URL protocol: ${u.protocol}`);
    }

    // Lowercase scheme and host
    const protocol = u.protocol.toLowerCase();
    const hostname = u.hostname.toLowerCase();

    // Strip default ports
    let port = u.port;
    if ((protocol === "http:" && port === "80") || (protocol === "https:" && port === "443")) {
        port = "";
    }

    // Normalize path
    let pathname = u.pathname || "/";
    if (pathname === "") pathname = "/";
    if (pathname !== "/" && pathname.endsWith("/")) {
        pathname = pathname.slice(0, -1);
    }

    // Build canonical string (no username/password, no query or fragment)
    const authority = port ? `${hostname}:${port}` : hostname;
    return `${protocol}//${authority}${pathname}`;
}