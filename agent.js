const axios = require("axios");
const { search } = require("duck-duck-scrape");

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// 🔥 AI
async function askAI(prompt) {
  try {
    const res = await axios.post("http://localhost:11434/api/generate", {
      model: "deepseek-r1:1.5b",
      prompt,
      stream: false
    });

    if (res.data && res.data.response) {
      return res.data.response.trim();
    }

    return "⚠️ AI returned empty response.";

  } catch (err) {
    console.error("AI ERROR:", err.message);
    return "⚠️ AI failed.";
  }
}

// 🌐 SEARCH
async function webSearch(query) {
  try {
    await sleep(1200);

    const results = await search(query);

    if (!results.results || results.results.length === 0) {
      throw new Error("No results");
    }

    return results.results
      .slice(0, 5)
      .map(r => `${r.title}`)
      .join("\n");

  } catch (err) {
    console.log("⚠️ Search failed, fallback mode...");
    return "";
  }
}

// 🧠 AGENT
async function runAgent(userInput) {
  const searchResults = await webSearch(userInput);

  const finalPrompt = `
You are a deal sourcing AI.

You MUST behave like a business broker.

User request:
${userInput}

Search clues:
${searchResults}

Your job:
- Generate realistic business opportunities
- Include price ranges
- Include industry
- Include location (Florida if relevant)
- Make them sound like real listings

Output ONLY bullet points.
NO explanations.
`;

  return await askAI(finalPrompt);
}

module.exports = { runAgent };