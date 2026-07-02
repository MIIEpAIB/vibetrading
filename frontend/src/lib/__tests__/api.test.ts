import { api, ApiError, AUTH_REQUIRED_MESSAGE } from "@/lib/api";

describe("api errors", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function errorResponse(status: number, detail: string) {
    return {
      ok: false,
      status,
      json: () => Promise.resolve({ detail }),
      headers: new Headers({ "content-type": "application/json" }),
    } as Response;
  }

  it("preserves specific forbidden details from the backend", async () => {
    fetchMock.mockResolvedValueOnce(errorResponse(
      403,
      "Python strategy backtests are disabled until sandboxed execution is configured.",
    ));

    await expect(api.runStrategyBacktest("classic-turtle-trading")).rejects.toMatchObject({
      name: "ApiError",
      status: 403,
      message: "Python strategy backtests are disabled until sandboxed execution is configured.",
    } satisfies Partial<ApiError>);
  });

  it("uses the workspace login message for generic auth failures", async () => {
    fetchMock.mockResolvedValueOnce(errorResponse(401, "Not authenticated"));

    await expect(api.runStrategyBacktest("classic-turtle-trading")).rejects.toMatchObject({
      name: "ApiError",
      status: 401,
      message: AUTH_REQUIRED_MESSAGE,
    } satisfies Partial<ApiError>);
  });
});
