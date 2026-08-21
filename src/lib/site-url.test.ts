import { describe, expect, it } from "vitest";
import { normaliseSiteUrl } from "./site-url";

describe("normaliseSiteUrl", () => {
  it("adds https to a bare host, the input that broke the production build", () => {
    // Typed into the Vercel dashboard as a host rather than a URL. new URL()
    // threw ERR_INVALID_URL inside metadataBase and took the whole build down
    // while collecting page data for /_not-found.
    expect(normaliseSiteUrl("kicka.vercel.com")).toBe("https://kicka.vercel.com");
  });

  it("leaves an already-absolute URL alone", () => {
    expect(normaliseSiteUrl("https://kicka.app")).toBe("https://kicka.app");
  });

  it("keeps localhost on http, since it has no certificate", () => {
    expect(normaliseSiteUrl("localhost:3100")).toBe("http://localhost:3100");
    expect(normaliseSiteUrl("http://localhost:3100")).toBe("http://localhost:3100");
  });

  it("drops a trailing slash so template strings cannot double it", () => {
    expect(normaliseSiteUrl("https://kicka.app/")).toBe("https://kicka.app");
    expect(`${normaliseSiteUrl("kicka.app/")}/sitemap.xml`).toBe(
      "https://kicka.app/sitemap.xml",
    );
  });

  it("strips a path, which would otherwise prefix every canonical and callback", () => {
    expect(normaliseSiteUrl("https://kicka.app/some/path")).toBe("https://kicka.app");
  });

  it("falls back rather than throwing, because a throw here fails the deploy", () => {
    expect(normaliseSiteUrl(undefined)).toBe("https://kicka.app");
    expect(normaliseSiteUrl("")).toBe("https://kicka.app");
    expect(normaliseSiteUrl("   ")).toBe("https://kicka.app");
    expect(normaliseSiteUrl("http://")).toBe("https://kicka.app");
  });

  it("always produces something new URL() accepts", () => {
    for (const input of ["kicka.vercel.com", "kicka.app/", "localhost:3100", "", "::::"]) {
      expect(() => new URL(normaliseSiteUrl(input))).not.toThrow();
    }
  });
});
