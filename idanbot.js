// idanbot.js
const {
  makeWASocket,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  DisconnectReason,
} = require("@whiskeysockets/baileys");
const qrcode = require("qrcode-terminal");
const dotenv = require("dotenv");
const axios = require("axios");
const { GoogleGenAI } = require("@google/genai");
dotenv.config();

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
});

async function idanai(context) {
  try {
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: context,
    });

    return response.text;
  } catch (error) {
    console.error("Error generating content:", error);
  }
}

async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState("auth_info");
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    printQRInTerminal: false,
    auth: state,
    version,
  });

  sock.ev.on("connection.update", (update) => {
    const { connection, qr, lastDisconnect } = update;
    if (qr) qrcode.generate(qr, { small: true });

    if (connection === "close") {
      const shouldReconnect =
        lastDisconnect?.error?.output?.statusCode !==
        DisconnectReason.loggedOut;
      console.log("Connection closed, reconnecting:", shouldReconnect);
      if (shouldReconnect) startBot();
    } else if (connection === "open") {
      console.log("✅ WhatsApp connected successfully!");
    }
  });

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("messages.upsert", async ({ messages }) => {
    const msg = messages[0];
    if (!msg.message || msg.key.fromMe) return;

    const sender = msg.key.remoteJid;
    const text =
      msg.message.conversation || msg.message.extendedTextMessage?.text || "";

    if (text.startsWith("idanmovie")) {
      const movieName = text.split("idanmovie")[1].trim();
      if (!movieName) {
        await sock.sendMessage(sender, {
          text: "Please provide a movie name.",
        });
        return;
      }

      await sock.sendPresenceUpdate("composing", sender);
      await sock.sendMessage(sender, { text: "🔎 Searching, please wait..." });

      try {
        const response = await axios.get(
          `https://mooviz.com.ng/api/imdb?movie=${encodeURIComponent(
            movieName
          )}&page=1`
        );

        const results = response.data.results;
        if (!results || results.length === 0) {
          await sock.sendMessage(sender, { text: "❌ No results found." });
          return;
        }

        const movie = results[0];
        const imageUrl = movie.poster_path
          ? `https://image.tmdb.org/t/p/w500${movie.poster_path}`
          : movie.image || null;

        const caption = `🎬 *${movie.title}*\n\n${
          movie.overview
        }\n\n📅 Release Date: ${
          movie.release_date
        }\n🔗Link: https://mooviz.com.ng/movieView/${
          movie.id
        }?title=${encodeURIComponent(movie.title)}&type=movie`;

        if (imageUrl) {
          await sock.sendMessage(sender, {
            image: { url: imageUrl },
            caption,
          });
        } else {
          await sock.sendMessage(sender, { text: caption });
        }
      } catch (err) {
        console.error("Error fetching movie:", err.message);
        await sock.sendMessage(sender, {
          text: "⚠️ Something went wrong while searching for the movie.",
        });
      }
    } else if (text.startsWith("idananime")) {
      const animeName = text.split("idananime")[1].trim();
      if (!animeName) {
        await sock.sendMessage(sender, {
          text: "Please provide an anime name.",
        });
        return;
      }

      await sock.sendPresenceUpdate("composing", sender);
      await sock.sendMessage(sender, { text: "🔎 Searching, please wait..." });

      try {
        const response = await axios.get(
          `https://mooviz.com.ng/api/anime/anime?search=${encodeURIComponent(
            animeName
          )}`
        );

        const results = response.data.results.data;
        if (!results || results.length === 0) {
          await sock.sendMessage(sender, { text: "❌ No results found." });
          return;
        }

        const movie = results[0];
        const imageUrl = movie.poster ? movie.poster : movie.image || null;

        const caption = `🎬 *${movie.title}*\n\n📅 Type: ${
          movie.eps ? `Episodes: ${movie.eps}` : "Single Episode"
        }\n🔗Link: https://mooviz.com.ng/animeView/${
          movie.id
        }?title=${encodeURIComponent(movie.title)}`;

        if (imageUrl) {
          await sock.sendMessage(sender, {
            image: { url: imageUrl },
            caption,
          });
        } else {
          await sock.sendMessage(sender, { text: caption });
        }
      } catch (err) {
        console.error("Error fetching movie:", err.message);
        await sock.sendMessage(sender, {
          text: "⚠️ Something went wrong while searching for the movie.",
        });
      }
    } else if (text.startsWith("idanai")) {
      const context = text.split("idanai")[1].trim();
      if (!context) {
        await sock.sendMessage(sender, {
          text: "Please provide a prompt.",
        });
        return;
      }

      await sock.sendPresenceUpdate("composing", sender);
      await sock.sendMessage(sender, { text: "🔎 thinking, please wait..." });

      try {
        const response = await idanai(context);
        await sock.sendMessage(sender, { text: response });
      } catch (error) {
        console.error("Error generating AI response:", error.message);
        await sock.sendMessage(sender, {
          text: "Sorry, something went wrong while generating the AI response.",
        });
      }
    }
  });
}

startBot();
