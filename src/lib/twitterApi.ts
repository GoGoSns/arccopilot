const NITTER_INSTANCES = [
  "https://nitter.privacydev.net",
  "https://nitter.poast.org",
  "https://nitter.tiekoetter.com",
  "https://nitter.weiler.rocks",
  "https://nitter.lucabased.xyz"
]

const SEARCH_QUERIES = ["Arc Network stablecoin", "Arc testnet"]
const FETCH_TIMEOUT_MS = 8000
const UNAVAILABLE_ERROR = "Tweets unavailable right now. Try refreshing in a few minutes."

export type TwitterTweet = {
  id: string
  text: string
  authorName: string
  authorHandle: string
  authorAvatar: string
  createdAt: string
  tweetUrl: string
}

async function fetchWithTimeout(url: string, ms: number): Promise<Response> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), ms)
  try {
    const res = await fetch(url, { signal: controller.signal })
    clearTimeout(timeout)
    return res
  } catch (err) {
    clearTimeout(timeout)
    throw err
  }
}

export async function fetchArcTweets(): Promise<TwitterTweet[]> {
  const errors: string[] = []
  let sawValidFeed = false

  for (const instance of NITTER_INSTANCES) {
    for (const query of SEARCH_QUERIES) {
      try {
        const url = instance + "/search/rss?q=" + encodeURIComponent(query) + "&f=tweets"
        const res = await fetchWithTimeout(url, FETCH_TIMEOUT_MS)
        if (!res.ok) {
          errors.push(instance + ": " + res.status)
          continue
        }

        const xmlText = await res.text()
        const tweets = parseNitterRSS(xmlText)
        sawValidFeed = true

        if (tweets.length > 0) {
          console.log("[Nitter] Success via " + instance + ", " + tweets.length + " tweets")
          return tweets
        }
      } catch (err) {
        errors.push(instance + ": fetch failed")
      }
    }
  }

  if (sawValidFeed) return []

  console.warn("[Nitter] All instances failed:", errors)
  throw new Error(UNAVAILABLE_ERROR)
}

function parseNitterRSS(xmlText: string): TwitterTweet[] {
  const parser = new DOMParser()
  const doc = parser.parseFromString(xmlText, "text/xml")
  const parseError = doc.querySelector("parsererror")
  if (parseError) throw new Error("Invalid RSS")

  const items = Array.from(doc.querySelectorAll("item"))
  return items.slice(0, 5).map((item, i) => {
    const title = item.querySelector("title")?.textContent || ""
    const link = item.querySelector("link")?.textContent || ""
    const pubDate = item.querySelector("pubDate")?.textContent || ""
    let creator = ""
    const creatorEl = item.getElementsByTagNameNS("http://purl.org/dc/elements/1.1/", "creator")[0]
    if (creatorEl) creator = creatorEl.textContent || ""
    const tweetUrl = link.replace(/https?:\/\/[^/]+/, "https://twitter.com")
    const handle = creator.replace(/^@/, "").trim() || "unknown"
    return {
      id: link.split("/").pop() || "tweet-" + i + "-" + Date.now(),
      text: title.replace(/^R to @\w+:\s*/, "").trim(),
      authorName: handle,
      authorHandle: handle,
      authorAvatar: "https://unavatar.io/twitter/" + handle,
      createdAt: pubDate,
      tweetUrl: tweetUrl
    }
  })
}
