import { TtlCache } from "../../src/utils/ttlCache";

describe("TtlCache", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("stores and retrieves values before expiry", () => {
    const nowSpy = jest.spyOn(Date, "now").mockReturnValue(1000);
    const cache = new TtlCache<string, string>(5000);

    cache.set("a", "value-a");
    nowSpy.mockReturnValue(1500);

    expect(cache.get("a")).toBe("value-a");
    expect(cache.has("a")).toBe(true);
  });

  it("expires values after ttl has elapsed", () => {
    const nowSpy = jest.spyOn(Date, "now").mockReturnValue(1000);
    const cache = new TtlCache<string, string>(100);

    cache.set("a", "value-a");
    nowSpy.mockReturnValue(1200);

    expect(cache.get("a")).toBeUndefined();
    expect(cache.has("a")).toBe(false);
  });

  it("evicts the oldest key when maxEntries limit is reached", () => {
    const nowSpy = jest.spyOn(Date, "now").mockReturnValue(1000);
    const cache = new TtlCache<string, string>(5000, 2);

    cache.set("first", "1");
    nowSpy.mockReturnValue(1001);
    cache.set("second", "2");
    nowSpy.mockReturnValue(1002);
    cache.set("third", "3");

    expect(cache.get("first")).toBeUndefined();
    expect(cache.get("second")).toBe("2");
    expect(cache.get("third")).toBe("3");
  });

  it("clears all entries", () => {
    const cache = new TtlCache<string, number>(5000);
    cache.set("x", 1);
    cache.set("y", 2);

    cache.clear();

    expect(cache.get("x")).toBeUndefined();
    expect(cache.get("y")).toBeUndefined();
  });
});
