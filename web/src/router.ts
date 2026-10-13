import { useEffect, useState } from "react";

/** Minimal hash router: "#/quotes/abc" -> ["quotes", "abc"]. */
export function useRoute(): string[] {
  const read = () => window.location.hash.replace(/^#\/?/, "").split("/").filter(Boolean).map(decodeURIComponent);
  const [route, setRoute] = useState(read);
  useEffect(() => {
    const onChange = () => setRoute(read());
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  return route;
}

export function go(...parts: string[]): void {
  window.location.hash = `#/${parts.map(encodeURIComponent).join("/")}`;
}

export const href = (...parts: string[]) => `#/${parts.map(encodeURIComponent).join("/")}`;
