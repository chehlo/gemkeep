import { describe, it, expect } from "vitest"
import { readFileSync } from "fs"
import { join } from "path"

describe("tauri.conf.json — asset protocol scope", () => {
  it("scope must explicitly name .gem-keep as a literal (not via ** wildcard)", () => {
    // WHY THIS TEST EXISTS:
    // Tauri sets `require_literal_leading_dot: true` on Unix.
    // This means `**` does NOT match hidden directories (e.g. `.gem-keep`).
    // The scope ["/**"] or ["$HOME/**"] silently fails to serve thumbnails from ~/.gem-keep/.
    //
    // The ONLY correct pattern is one where `.gem-keep` appears as a LITERAL component,
    // e.g. "$HOME/.gem-keep/**" which Tauri expands to "/home/user/.gem-keep/**".
    //
    // This test reproduces the runtime error:
    //   ERROR tauri::protocol::asset: asset protocol not configured to allow the path
    // Pair this with the Rust tests in src/asset_scope_tests.rs which verify
    // the actual glob matching behavior at the MatchOptions level.
    const confPath = join(process.cwd(), "src-tauri", "tauri.conf.json")
    const conf = JSON.parse(readFileSync(confPath, "utf-8"))
    const assetProto = conf?.app?.security?.assetProtocol
    expect(assetProto, "app.security.assetProtocol must exist").toBeDefined()
    expect(assetProto.enable, "assetProtocol.enable must be true").toBe(true)

    const scope: string[] = assetProto.scope ?? []
    expect(scope, "scope must not be empty").not.toHaveLength(0)

    // Must NOT use bare `**` to reach .gem-keep — it will not match at runtime
    const bareWildcard = scope.filter(
      (s: string) => s === "/**" || s === "**" || s === "$HOME/**" || s === "~/**"
    )
    expect(
      bareWildcard,
      `scope must not use bare /** or $HOME/** — ** does not match .gem-keep on Unix (require_literal_leading_dot=true): ${bareWildcard}`
    ).toHaveLength(0)

    // Must explicitly include the .gem-keep directory as a literal path component
    const hasDotGemKeep = scope.some(
      (s: string) => s.includes(".gem-keep")
    )
    expect(
      hasDotGemKeep,
      `scope must explicitly name .gem-keep to allow thumbnail access; got: ${JSON.stringify(scope)}`
    ).toBe(true)
  })
})
