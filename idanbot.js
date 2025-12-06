// idanbot.js
const express = require("express");
const {
  makeWASocket,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  DisconnectReason,
} = require("@whiskeysockets/baileys");
const qrcode = require("qrcode-terminal");
const dotenv = require("dotenv");
const axios = require("axios");
const { UberAPI } = require("./src/api"); // <-- factory
dotenv.config();
const { GoogleGenerativeAI } = require("@google/generative-ai"); // Legacy import

let GEMINI_API_KEY = process.env.GEMINI_API_KEY;
let google_api_key = process.env.MATRIX_API;
if (!GEMINI_API_KEY) {
  throw new Error("GEMINI_API_KEY not found in env! Check .env file.");
}

console.log("API Key loaded successfully"); // Debug log
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY); // Legacy init
// const { GoogleGenAI } = require("@google/genai");

const app = express();
// const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const conversations = new Map();
let med_analysis = "";
let rideNumber = "";
let phone = "";
const tools = [
  {
    functionDeclarations: [
      // {
      //   name: "searchMovie",
      //   description:
      //     "Search for a movie by title and return details with poster, overview, release date, and link.",
      //   parameters: {
      //     type: "object",
      //     properties: {
      //       movieName: {
      //         type: "string",
      //         description:
      //           "The exact or partial movie title the user is asking for.",
      //       },
      //     },
      //     required: ["movieName"],
      //   },
      // },
      // {
      //   name: "registerAsPassenger",
      //   description:
      //     "Initiate passenger registration. User needs to provide full name after this is called.",
      //   parameters: {
      //     type: "object",
      //     properties: {},
      //     required: [],
      //   },
      // },
      // {
      //   name: "registerAsDriver",
      //   description:
      //     "Initiate driver registration. User needs to provide full name after this is called.",
      //   parameters: {
      //     type: "object",
      //     properties: {},
      //     required: [],
      //   },
      // },
      {
        name: "login",
        description:
          "Initiate login process. User will be prompted to enter their password.",
        parameters: {
          type: "object",
          properties: {},
          required: [],
        },
      },
      {
        name: "emergencyRide",
        description:
          "Handle ALL medical emergencies. Analyzes severity, sends formatted response to user, THEN calls requestRide. Makes sure user sends medical symptoms first before calling this. If emergency details are missing, ask user for more info.",
        parameters: {
          type: "object",
          properties: {
            userMessage: {
              type: "string",
              description: "The exact user message describing the emergency",
            },
          },
          required: ["userMessage"],
        },
      },
      {
        name: "requestRide",
        description:
          "Ask for user's emergency first. Start the ride request process. User needs to provide pickup location (GPS pin).",
        parameters: {
          type: "object",
          properties: {},
          required: [],
        },
      },
      {
        name: "goOnline",
        description:
          "Go online as a driver to start accepting rides. Only available for drivers.",
        parameters: {
          type: "object",
          properties: {},
          required: [],
        },
      },
      {
        name: "viewAvailableRides",
        description:
          "View all available rides waiting to be accepted by drivers.",
        parameters: {
          type: "object",
          properties: {},
          required: [],
        },
      },
      {
        name: "viewMyRides",
        description:
          "View your ride history including ride ID, status, and fare amount. Anything like: rides, my rides calls this.",
        parameters: {
          type: "object",
          properties: {},
          required: [],
        },
      },
      {
        name: "cancelRide",
        description: "Cancel an active or pending ride.",
        parameters: {
          type: "object",
          properties: {},
          required: [],
        },
      },
      {
        name: "depositFunds",
        description: "Deposit funds into your wallet (minimum N1000).",
        parameters: {
          type: "object",
          properties: {},
          required: [],
        },
      },
      {
        name: "checkBalance",
        description:
          "Check your current wallet balance and pending withdrawals.",
        parameters: {
          type: "object",
          properties: {},
          required: [],
        },
      },
      // {
      //   name: "releaseFunds",
      //   description: "Release funds from your balance.",
      //   parameters: {
      //     type: "object",
      //     properties: {},
      //     required: [],
      //   },
      // },
      {
        name: "requestWithdrawal",
        description:
          "Request a withdrawal of funds from your wallet (minimum N1000).",
        parameters: {
          type: "object",
          properties: {},
          required: [],
        },
      },
      {
        name: "logout",
        description: "Log out from your account.",
        parameters: {
          type: "object",
          properties: {},
          required: [],
        },
      },
      {
        name: "goOffline",
        description: "Go offline as a driver and stop accepting rides.",
        parameters: {
          type: "object",
          properties: {},
          required: [],
        },
      },
      {
        name: "viewTransactionHistory",
        description:
          "View your transaction history including deposits, withdrawals, and ride payments. Anything that looks like transaction or history calls this",
        parameters: {
          type: "object",
          properties: {},
          required: [],
        },
      },
      {
        name: "completeRide",
        description: "Complete an active ride and release funds to the driver.",
        parameters: {
          type: "object",
          properties: {},
          required: [],
        },
      },
    ],
  },
];
const MODEL_FALLBACKS = [
  "gemini-2.5-flash", // Your current (fast but overload-prone)
  "gemini-2.0-flash-exp", // Experimental, often less loaded
  "gemini-1.5-pro", // Legacy stable (if 2.x fails hard)
];

async function idanai(messages, sock, jid, modelIndex = 0, sender) {
  console.log(modelIndex);
  const modelName = MODEL_FALLBACKS[modelIndex];
  if (!modelName) return "All AI models are currently down. Try again later.";

  const model = genAI.getGenerativeModel({
    model: modelName,
    tools,
    systemInstruction: `You are MediLift — a smart, compassionate, and helpful WhatsApp assistant. You help users with medical emergency transport services. When someone asks about a movie, use the searchMovie tool. When they ask to deposit, withdraw, request a ride, or manage their account, intelligently call the appropriate menu function (depositFunds, requestWithdrawal, requestRide, etc.). 
    Note Do not use conversational history when calling functions; focus ONLY on the user's CURRENT REQUEST.
Users trust you with their LIVES. Always show them you understand their emergency BEFORE taking action.`,
  });

  const maxRetries = 3;
  let delay = 1000;

  for (let i = 0; i < maxRetries; i++) {
    try {
      // const history = messages.slice(0, -1).map((m) => ({

      //   role: m.role||user,
      //   // role: m.role==="user" ? "user" : "model",
      //   parts: [{ text: m.content }],
      // }));
      const history = messages.slice(0, -1).map((m, index) => {
        console.log(`Mapping message ${index}:`, m);
        return {
          role: m.role === "assistant" ? "model" : "user", // Fallback
          parts: [{ text: m.content || "" }],
        };
      });

      const lastMsg = messages[messages.length - 1].content;

      const chat = model.startChat({
        history,
        generationConfig: { temperature: 0.8, maxOutputTokens: 512 },
      });
      // console.log("🔍 DEBUGGING MESSAGES:");
      // console.log("• Total messages:", messages?.length || "UNDEFINED");
      // console.log("• messages type:", typeof messages);
      // console.log("• Raw messages:", messages);
      if (!messages || !Array.isArray(messages)) {
        console.log("❌ ERROR: messages is NOT an array!");
        return "Error: No conversation history";
      }
      // messages.forEach((msg, index) => {
      //   console.log(`Message ${index}:`, {
      //     role: msg?.role,
      //     content: msg?.content,
      //     hasRole: !!msg?.role,
      //     hasContent: !!msg?.content,
      //   });
      // });
      const result = await chat.sendMessage(lastMsg);
      const response = result.response;

      // Check for function call
      const functionCall = response.candidates?.[0]?.content?.parts?.find(
        (p) => p.functionCall
      )?.functionCall;

      // if (functionCall?.name === "searchMovie") {
      //   const movieName = functionCall.args?.movieName;
      //   if (movieName) {
      //     await searchMovie(sock, jid, movieName);
      //     // Optional: confirm
      //     await sock.sendMessage(jid, {
      //       text: `Found "${movieName}"! Check above`,
      //     });
      //   }
      //   // ✅ RESET HERE
      //   return undefined; // Function handled — exit
      // }

      // Menu function handlers
      // if (functionCall?.name === "registerAsPassenger") {
      //   const phone = jid.replace("@s.whatsapp.net", "");
      //   await handleMenu(jid, "1", phone);
      //   // ✅ RESET HERE

      //   return undefined;
      // }
      // if (functionCall?.name === "registerAsDriver") {
      //   const phone = jid.replace("@s.whatsapp.net", "");
      //   await handleMenu(jid, "2", phone);
      //   return undefined;
      // }
      if (functionCall?.name === "login") {
        await handleMenu(jid, "3", phone, sender);
        return undefined;
      }
      if (functionCall?.name === "emergencyRide") {
        const userMessage = functionCall.args?.userMessage;
        if (userMessage) {
          const state = userState.get(jid);
          if (state?.step === "ride_booked") {
            await sock.sendMessage(jid, {
              text: "✅ Emergency ride already booked! Help is on the way.",
            });
            return; // Return text so it continues
          }
          await handleEmergencyRide(sock, jid, userMessage);
        }
        return;
      }
      if (functionCall?.name === "requestRide") {
        await handleMenu(jid, "4", "");

        return undefined;
      }
      if (functionCall?.name === "goOnline") {
        await handleMenu(jid, "5", "");

        return undefined;
      }
      if (functionCall?.name === "viewAvailableRides") {
        await handleMenu(jid, "6", "");

        return undefined;
      }
      if (functionCall?.name === "viewMyRides") {
        await handleMenu(jid, "7", "");

        return undefined;
      }
      if (functionCall?.name === "cancelRide") {
        await handleMenu(jid, "8", "");

        return undefined;
      }
      if (functionCall?.name === "depositFunds") {
        await handleMenu(jid, "9", "");

        return undefined;
      }
      if (functionCall?.name === "checkBalance") {
        await handleMenu(jid, "10", "");

        return undefined;
      }
      if (functionCall?.name === "releaseFunds") {
        await handleMenu(jid, "11", "");

        return undefined;
      }
      if (functionCall?.name === "requestWithdrawal") {
        await handleMenu(jid, "12", "");

        return undefined;
      }
      if (functionCall?.name === "logout") {
        await handleMenu(jid, "13", "");

        return undefined;
      }
      if (functionCall?.name === "goOffline") {
        await handleMenu(jid, "14", "");

        return undefined;
      }
      if (functionCall?.name === "viewTransactionHistory") {
        await handleMenu(jid, "15", "");

        return undefined;
      }
      if (functionCall?.name === "completeRide") {
        await handleMenu(jid, "16", "");

        return undefined;
      }

      // Normal text reply
      const text = response.text();
      return text;
    } catch (error) {
      console.error(
        `Gemini Error (${modelName}, attempt ${i + 1}):`,
        error.message
      );

      const isOverload =
        error.status === 503 || /overloaded|UNAVAILABLE/i.test(error.message);

      if (isOverload && i < maxRetries - 1) {
        await new Promise((r) => setTimeout(r, delay));
        delay *= 2;
        continue;
      }

      if (isOverload || error.status === 404) {
        return idanai(messages, sock, jid, modelIndex + 1, sender); // Fallback model
      }

      if (error.message?.includes("SAFETY"))
        return "Can't respond to that — blocked content.";
      if (error.message?.includes("quota"))
        GEMINI_API_KEY = process.env.GEMINI_API_KEY;
      // return "Daily limit reached. Try tomorrow!";
      return "ran into some issues. Please repeat your request.";
    }
  }
  // ✅ ADD THIS RIGHT BEFORE THE FINAL RETURN

  return "I'm having issues connecting to the AI. Try again in a bit!";
}

/* ==================== STATE ==================== */
const userState = new Map(); // jid → { step, data }
const activeTrackers = new Map(); // jid → { interval, rideId }

const HELP_MENU = `
*UBER ESCROW – LIVE TRACKING & PAYMENTS*

*PASSENGER*
1. Register Passenger
3. Login


*DRIVER*
2. Register Driver
3. Login

Type *!help* for menu | *!track* for live location
`.trim();
const HELP_MENU2 = `
*UBER ESCROW – LIVE TRACKING & PAYMENTS*

*PASSENGER*
4. Request Ride (GPS)
7. My Rides
8. Cancel Ride
9. Deposit Funds
10. Check Balance
11. Release Funds
13. Logout
15. Transaction History
16. Complete Ride

*DRIVER*
5. Go Online
6. Accept Ride
7. My Rides
9. Deposit Funds
10. Check Balance
12. Request Withdrawal
13. Logout
14. Go Offline
15. Transaction History
16. Complete Ride

Type *!help* for menu | *!track* for live location
`.trim();

let sock;

/* ==================== BOT START ==================== */
async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState("auth_info");
  const { version } = await fetchLatestBaileysVersion();

  sock = makeWASocket({
    printQRInTerminal: false,
    auth: state,
    version,
  });

  sock.ev.on("connection.update", (update) => {
    const { connection, qr, lastDisconnect } = update;
    if (qr) qrcode.generate(qr, { small: true });
    if (connection === "close") {
      const reconnect =
        lastDisconnect?.error?.output?.statusCode !==
        DisconnectReason.loggedOut;
      if (reconnect) startBot();
    } else if (connection === "open") {
      console.log("WhatsApp connected");
    }
  });

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("messages.upsert", async ({ messages }) => {
    const msg = messages[0];
    if (!msg.message || msg.key.fromMe) return;
    const sender = msg.pushName || msg.key.remoteJid.split("@")[0];

    const jid = msg.key.remoteJid;
    console.log(msg.key);
    topjid = jid;
    const api = new UberAPI(jid);

    phone =
      (msg.key.remoteJid.includes("@s.whatsapp.net")
        ? msg.key.remoteJid
        : msg.key.remoteJidAlt?.includes("@s.whatsapp.net")
        ? msg.key.remoteJidAlt
        : null
      )?.replace("@s.whatsapp.net", "") || "unknown";
    console.log("Phone number extracted:", phone);
    const text =
      msg.message.conversation || msg.message.extendedTextMessage?.text || "";
    console.log("Received message:", text);
    if (!api.getToken()) {
      await handleMenu(jid, "3", phone, sender);
    }
    // let conversation = conversations.get(phone) || []; //correct one
    let conversation = []; //temporarily switxhes off
    conversation.push({
      role: "user",
      content: msg.message.conversation || "",
    });
    /* ---------- MOVIE / ANIME / AI ---------- */
    if (text.toLowerCase().startsWith("idanmovie")) {
      // … (your existing movie code – unchanged)
      const movieName = text.toLowerCase().split("idanmovie")[1]?.trim();
      if (!movieName) {
        await sock.sendMessage(jid, {
          text: "Please provide a movie name.",
        });
        return;
      }

      await sock.sendPresenceUpdate("composing", jid);
      await sock.sendMessage(jid, { text: "🔎 Searching, please wait..." });
      await searchMovie(sock, jid, movieName);
      return;
    }
    if (text.toLowerCase().startsWith("idananime")) {
      // … (your existing anime code – unchanged)
      const animeName = text.toLowerCase().split("idananime")[1]?.trim();
      if (!animeName) {
        await sock.sendMessage(jid, {
          text: "Please provide an anime name.",
        });
        return;
      }

      await sock.sendPresenceUpdate("composing", jid);
      await sock.sendMessage(jid, { text: "🔎 Searching, please wait..." });

      try {
        const response = await axios.get(
          `https://mooviz.com.ng/api/anime/anime?search=${encodeURIComponent(
            animeName
          )}`
        );

        const results = response.data.results.data;
        if (!results || results.length === 0) {
          await sock.sendMessage(jid, { text: "❌ No results found." });
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
          await sock.sendMessage(jid, {
            image: { url: imageUrl },
            caption,
          });
        } else {
          await sock.sendMessage(jid, { text: caption });
        }
      } catch (err) {
        console.error("Error fetching movie:", err.message);
        await sock.sendMessage(jid, {
          text: "⚠️ Something went wrong while searching for the movie.",
        });
      }
      return;
    }
    // ——— Add this at the top of your file (outside any function) ———
    // const userChatHistory = new Map(); // Map<userJid, Array<{role: string, content: string}>>

    // Optional: Limit history to last 20 messages per user (saves memory & tokens)
    const MAX_HISTORY = 19;

    // ——— Your improved message handler ———
    /* ---------- GPS ---------- */
    // REPLACE your GPS handler with this:
    if (msg.message?.locationMessage) {
      const { degreesLatitude: lat, degreesLongitude: lng } =
        msg.message.locationMessage;
      const state = userState.get(jid);

      // MEDICAL AGENT IS SETTING HOSPITAL LOCATION (GPS ONLY)
      if (state?.step === "medical_agent_waiting_for_hospital_gps") {
        const { pickuplat, pickuplng, rideId, passengerName } = state.data;
        console.log(state.data);
        const { distanceKm, durationSec } = await getDistance(
          pickuplat,
          pickuplng,
          lat,
          lng
        );
        const newFare = (distanceKm / 1000) * 1000 + (durationSec / 60) * 100;
        const api = new UberAPI(jid);
        try {
          await api.acceptRide(rideId, {
            dropoff_lat: lat,
            dropoff_lng: lng,
            fare: newFare,
          });

          await send(
            jid,
            `
*RIDE ACCEPTED — EN ROUTE TO HOSPITAL*

Ride #${rideId}
Patient: *${passengerName}*
Fare: N${newFare}

Proceed immediately — life in transit.
        `.trim()
          );
          await sock.sendMessage(jid, {
            location: {
              degreesLatitude: lat,
              degreesLongitude: lng,
            },
          });

          userState.delete(jid);
        } catch (err) {
          await send(
            jid,
            `Failed to accept ride: ${err.response?.data?.error || err.message}`
          );
          userState.delete(jid);
        }

        return; // Stop further processing — this was the final action
      }

      // ALL OTHER GPS MESSAGES (passenger sending pickup, etc.)
      await handleLocation(jid, lat, lng);
    }

    // Check if user is in a form state (higher priority than AI)
    if (userState.has(jid)) {
      const state = userState.get(jid);
      if (state.step !== "ride_booked") {
        // ✅ SKIP for ride_booked - allow AI
        await handleForm(jid, text, phone, sender);
        return;
      }
      // For ride_booked, fall through to AI for normal conversation
    }

    /* ---------- COMMANDS ---------- */
    if (text === "!help" || text === "help") {
      stopTracking(jid);
      userState.delete(jid);
      const api = new UberAPI(topjid);
      console.log(api.getToken());
      if (!api.getToken()) {
        return send(jid, HELP_MENU);
      } else {
        return send(jid, HELP_MENU2);
      }
    }
    if (text === "!track") {
      const api = new UberAPI(jid);
      if (!api.getToken()) return send(jid, "Login first.");

      const rides = await api.getMyRides();
      const activeRide = rides.find(
        (r) => r.status === "accepted" || r.status === "in_progress"
      );
      if (!activeRide) return send(jid, "No active ride.");

      try {
        const location = await api.getRideLocation(activeRide.id); // New API call

        if (req.user.role === "user") {
          // Passenger
          if (location.driverLocation) {
            const mapLink = `https://maps.google.com/maps?q=${location.driverLocation.lat},${location.driverLocation.lng}`;
            await send(
              jid,
              `
*Driver Location*

Driver: *${location.driver.name}*
Location: ${location.driverLocation.lat.toFixed(
                4
              )}, ${location.driverLocation.lng.toFixed(4)}
Map: ${mapLink}

ETA: ${Math.round(location.dist)} mins
        `.trim()
            );
          } else {
            await send(jid, "Driver location not available yet.");
          }
        } else {
          // Driver
          if (location.passengerLocation) {
            const mapLabel = `https://maps.google.com/maps?q=${location.passengerLocation.lat},${location.passengerLocation.lng}`;
            await send(
              jid,
              `
*Passenger Location*

Passenger: *${location.passenger.name}*
Location: ${location.passengerLocation.lat.toFixed(
                4
              )}, ${location.passengerLocation.lng.toFixed(4)}
Map: ${mapLabel}

Pickup: ${location.pickup.lat.toFixed(4)}, ${location.pickup.lng.toFixed(4)}
        `.trim()
            );
          } else {
            await send(jid, "Passenger location not available yet.");
          }
        }
      } catch (err) {
        await send(jid, "Error fetching location.");
      }
      return;
    }
    if (text === "!cancel") return cancelRide(jid);

    // Default: Send all other messages to AI for natural conversation
    const userId = jid;
    // const prompt = text; // Use entire message as prompt

    // // Initialize history
    // if (!userChatHistory.has(userId)) {
    //   userChatHistory.set(userId, []);
    // }
    // const history = userChatHistory.get(userId);

    // // Add user message
    // history.push({ role: "user", content: prompt });

    // Limit history
    if (conversation.length > MAX_HISTORY) {
      conversation.splice(0, conversation.length - MAX_HISTORY);
    }

    await sock.sendPresenceUpdate("composing", jid);

    try {
      const result = await idanai(conversation, sock, jid, 0, sender);

      // ✅ SMART HANDLING:
      if (typeof result === "string") {
        // Normal text response
        await sock.sendMessage(jid, { text: result });
        conversation.push({ role: "assistant", content: result });
      } else {
      }

      conversations.set(phone, conversation);
    } catch (error) {
      console.error("AI Error for", userId, ":", error.message || error);
      await sock.sendMessage(jid, {
        text: "Sorry, my brain is tired right now. Try again later!",
      });
      // history.pop(); // Clean up on error
    }
  });
}
startBot();

/* ==================== UTILS ==================== */
async function send(jid, text) {
  await sock.sendMessage(jid, { text });
}
async function handleEmergencyRide(sock, jid, userMessage) {
  // Generate emergency analysis
  const state = userState.get(jid);
  if (state?.step === "ride_booked") {
    return send(jid, "✅ Emergency ride already requested!");
  }
  const emergencyPrompt = `Analyze this emergency: "${userMessage}"

MANDATORY FORMAT ONLY:
 [CRITICAL/URGENT] MEDICAL EMERGENCY DETECTED
 Original Symptoms: [User's symptoms]
 Diagnosis: [Medical terms]
 Severity: [CRITICAL/URGENT]
 Recommended: [Ambulance type]`;
  const modelName = MODEL_FALLBACKS[0];
  const emergencyModel = genAI.getGenerativeModel({
    model: modelName,
    systemInstruction: emergencyPrompt,
  });

  const result = await emergencyModel.generateContent(emergencyPrompt);
  const analysis = result.response.text();
  med_analysis = analysis;

  // 1. SEND ANALYSIS TO USER FIRST
  await sock.sendMessage(jid, { text: analysis });

  // 2. THEN CALL requestRide (your existing code)
  await handleMenu(jid, "4", ""); // Opens ride request menu

  // Optional: Confirm action
  // await sock.sendMessage(jid, {
  //   text: "🚨 Emergency ride requested! Please share your GPS location now.",
  // });
}
/* ---------- LIVE TRACKING ---------- */
function startTracking(jid, rideId) {
  stopTracking(jid);
  const interval = setInterval(async () => {
    try {
      const api = new UberAPI(jid);
      const ride = await api.getRide(rideId);
      if (["completed", "cancelled"].includes(ride.status)) {
        await send(jid, `*Ride ${ride.status.toUpperCase()}*`);
        stopTracking(jid);
        return;
      }
      const driver = ride.driver;
      if (driver?.location_lat && driver?.location_lng) {
        const dist = haversine(
          ride.pickup_lat,
          ride.pickup_lng,
          driver.location_lat,
          driver.location_lng
        );
        await send(
          jid,
          `
*Live Update*

Driver: *${driver.name}*
Distance: *${dist.toFixed(1)} km*
Status: *${ride.status}*
        `.trim()
        );
      } else {
        await send(jid, `*Please stay with us, driver is on the way!*`);
        // userState.delete(jid);
        return;
      }
    } catch (err) {
      console.log("Tracking error:", err.message);
    }
  }, 120_000);
  userState.delete(jid);
  activeTrackers.set(jid, { interval, rideId });
}
function stopTracking(jid) {
  const t = activeTrackers.get(jid);
  if (t) clearInterval(t.interval);
  activeTrackers.delete(jid);
}
async function getDistance(plat, plng, dlat, dlng) {
  const url =
    `https://maps.googleapis.com/maps/api/distancematrix/json?` +
    `origins=${plat},${plng}&destinations=${dlat},${dlng}&key=${google_api_key}`;

  const res = await axios.get(url);

  const data = res.data.rows[0].elements[0];
  const distanceKm = data.distance.value;
  const durationSec = data.duration.value;

  console.log("Distance:", data.distance.text);
  console.log("Distance (meters):", data.distance.value);
  console.log("Duration:", data.duration.value);
  return { distanceKm, durationSec };
}
/* ---------- HAVERSINE ---------- */
function haversine(lat1, lon1, lat2, lon2) {
  const toRad = (x) => (x * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/* ---------- CANCEL RIDE ---------- */
async function cancelRide(jid) {
  if (!rideNumber) return send(jid, "No active ride to cancel.");

  try {
    const api = new UberAPI(jid);
    await api.cancelRide(rideNumber);
    await send(jid, "*Ride cancelled.*");
    userState.delete(jid);
  } catch (err) {
    const msg = err.response?.data?.error || err.message;
    await send(jid, `Cannot cancel: ${msg}`);
  }
}

/* ---------- GPS HANDLER ---------- */
async function handleLocation(jid, lat, lng) {
  const state = userState.get(jid);

  if (!state || !["ride_pickup", "ride_dropoff"].includes(state.step))
    return "Please request a ride first.";

  if (state.step === "ride_pickup") {
    state.data.pickup_lat = lat;
    state.data.pickup_lng = lng;
    // state.step = "ride_dropoff";
    // await send(
    //   jid,
    //   `Pickup set: ${lat.toFixed(4)}, ${lng.toFixed(
    //     4
    //   )}\nNow send *dropoff* (pin icon)`
    // );

    const api = new UberAPI(jid);
    try {
      const ride = await api.requestRide({
        emergency_session: med_analysis,
        pickup_lat: state.data.pickup_lat,
        pickup_lng: state.data.pickup_lng,
        dropoff_lat: state.data.pickup_lat,
        dropoff_lng: state.data.pickup_lng,
      });
      await send(
        jid,
        `
*RIDE BOOKED!*

Please hang in there, an agent will contact you rightaway.
 ${ride.driver?.name ? `*${ride.driver.name}*` : "..."}
`.trim()
        // Fare: *$${ride.fare}*
      );
      rideNumber = ride.id;
      state.step = "ride_booked"; // Mark as done

      // ✅ RETURN RESPONSE so AI can continue conversation
      return "✅ Emergency ride booked successfully! Help is on the way. How else can I assist you?";
    } catch (err) {
      const msg =
        err.response?.data?.errors?.[0]?.msg ||
        err.response?.data?.error ||
        "No drivers.";
      await send(jid, `Failed: ${msg}`);
      return `Sorry, couldn't book: ${msg}`;
    }
  }
  console.log(userState.get(jid));
  return "Location received.";
}

async function searchMovie(sock, jid, movieName) {
  try {
    const response = await axios.get(
      `https://mooviz.com.ng/api/imdb?movie=${encodeURIComponent(
        movieName
      )}&page=1`
    );

    const results = response.data.results;
    if (!results || results.length === 0) {
      await sock.sendMessage(jid, { text: "❌ No results found." });
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
      await sock.sendMessage(jid, {
        image: { url: imageUrl },
        caption,
      });
    } else {
      await sock.sendMessage(jid, { text: caption });
    }
  } catch (err) {
    console.error("Error fetching movie:", err.message);
    await sock.sendMessage(jid, {
      text: "⚠️ Something went wrong while searching for the movie.",
    });
  }
}
/* ---------- MENU ---------- */
async function handleMenu(jid, text, phone, sender) {
  const api = new UberAPI(jid);
  if (!api.getToken()) {
    try {
      const api = new UberAPI(jid);
      const res = await api.login({
        phone: phone,
        name: sender,
        emergency_type: "",
      });
      await send(jid, `Welcome ${res.user.name}.`);
    } catch (err) {
      await send(jid, `Failed: ${err.response?.data?.error || err.message}`);
      userState.set(jid, { step: "login_pass", data: { phone: data.phone } });
      await send(jid, "Try again. Enter *password*:");
    }
  }
  if (userState?.step === "ride_booked") {
    return "✅ Your emergency ride is already booked! Help is on the way."; // ✅ RETURN
  }
  switch (text) {
    case "1": {
      userState.set(jid, { step: "reg_name", data: { phone, role: "user" } });
      await send(jid, `Phone: *${phone}*\nEnter *full name*:`);
      break;
    }
    case "2": {
      userState.set(jid, { step: "reg_name", data: { phone, role: "driver" } });
      await send(jid, `Phone: *${phone}*\nEnter *full name*:`);
      break;
    }
    case "3": {
      // userState.set(jid, { step: "login_pass", data: { phone } });
      // await send(jid, `Login: *${phone}*\nEnter *password*:`);
      try {
        const api = new UberAPI(jid);
        const res = await api.login({
          phone: phone,
          name: sender,
          emergency_type: "",
        });
        // await send(
        //   jid,
        //   `Welcome *${res.user.name}* You can ask for a ride now or manage your account.`
        // );
      } catch (err) {
        await send(jid, `Failed: ${err.response?.data?.error || err.message}`);
        userState.set(jid, { step: "login_pass", data: { phone: data.phone } });
        await send(jid, "Try again. Enter *password*:");
      }
      break;
    }
    case "4": {
      const api = new UberAPI(jid);
      if (!api.getToken()) return send(jid, "Login first.");
      userState.set(jid, { step: "ride_pickup", data: {} });
      await send(jid, "Send your location for *pickup*");
      break;
    }
    case "5": {
      const api = new UberAPI(jid);
      if (!api.getToken()) return send(jid, "Login first.");
      await api.updateLocation({
        lat: 37.7749,
        lng: -122.4194,
        available: true,
      });
      await send(jid, "You are *online*!");

      setInterval(async () => {
        const offset = 0.001 * (Math.random() - 0.5);
        await new UberAPI(jid).updateLocation({
          lat: 37.7749 + offset,
          lng: -122.4194 + offset,
          available: true,
        });
      }, 30_000);
      break;
    }
    case "6": {
      const api = new UberAPI(jid);
      if (!api.getToken()) {
        await send(jid, "Login first with `3`.");
        break;
      }

      // Get profile to check role
      const profile = await api.getProfile();
      console.log("Profile:", profile);
      if (profile.role !== "agent" && profile.role !== "driver") {
        await send(jid, "Only drivers can accept rides.");
        break;
      }

      const available = await api.getAvailableRides();

      if (available.length === 0) {
        await send(jid, "No rides available. Waiting for passengers...");
        break;
      }

      let msg = "*Available Rides*\n\n";
      available.forEach((r, i) => {
        msg += `${i + 1}. #${r.id}\n`;
        msg += `   Passenger: ${r.passenger.name}\n`;
        msg += `   Phone: ${r.passenger.phone}\n`;
        msg += `   Fare: *N${r.fare.toFixed(2)}*\n\n`;
      });
      msg += "Reply with ride number to *accept*.";

      await send(jid, msg.trim());
      userState.set(jid, {
        step: "accept_ride_number",
        data: { rides: available },
      });
      break;
    }
    case "7": {
      const api = new UberAPI(jid);
      if (!api.getToken()) return send(jid, "Login first.");
      const rides = await api.getMyRides();
      const list = rides.length
        ? rides
            .map((r) => `#${r.id} | ${r.status.toUpperCase()} | $${r.fare}`)
            .join("\n")
        : "No rides yet.";
      await send(jid, `*Your Rides*\n\n${list}`);
      break;
    }
    case "8": {
      return cancelRide(jid);
    }
    case "9": {
      await send(jid, "Enter amount to *deposit* (min N1000):");
      userState.set(jid, { step: "deposit_amount", data: {} });
      break;
    }
    case "10": {
      const api = new UberAPI(jid);
      if (!api.getToken()) return send(jid, "Login first.");
      const balance = await api.getBalance();
      if (balance) {
        await send(
          jid,
          `
*Wallet*

Available: *N${balance.balance}*
Pending Withdrawal: *N${balance.pendingWithdrawals}*
  `.trim()
        );
      }
      break;
    }
    case "11": {
      await send(jid, "Enter amount to *release* from balance:");
      userState.set(jid, { step: "release_amount", data: {} });
      break;
    }
    case "12": {
      const api = new UberAPI(jid);
      if (!api.getToken()) {
        await send(jid, "Login first with `3`.");
        break;
      }

      const balance = await api.getBalance();
      if (balance.balance < 1000) {
        await send(jid, "Minimum withdrawal: *N1000*");
        break;
      }

      await send(
        jid,
        `
*Withdraw Funds*

Available: *N${balance.balance}*
Enter amount (min N1000):
  `.trim()
      );

      userState.set(jid, { step: "withdraw_amount", data: {} });
      break;
    }
    case "13": {
      const api = new UberAPI(jid);
      api.clearToken();
      userState.delete(jid);
      await send(jid, "Logged out. Send Login to manage your account.");
      break;
    }
    case "14": {
      const api = new UberAPI(jid);
      if (!api.getToken()) return send(jid, "Login first.");
      await api.updateLocation({ lat: 0, lng: 0, available: false });
      await send(jid, "You are now *offline*.");
      break;
    }
    case "15": {
      const api = new UberAPI(jid);
      const txs = await api.getTransactions();
      let msg = "*Transaction History*\n\n";
      txs.forEach((t) => {
        msg += `• ${t.type.toUpperCase()} N${t.amount} — ${new Date(
          t.createdAt
        ).toLocaleDateString()}\n`;
      });
      await send(jid, msg);
      break;
    }
    case "16": {
      const api = new UberAPI(jid);
      if (!api.getToken()) {
        await send(jid, "Login first with `3`.");
        break;
      }

      // Get active ride
      const rides = await api.getMyRides();
      const activeRide = rides.find(
        (r) => r.status === "accepted" || r.status === "ongoing"
      );

      if (!activeRide) {
        await send(jid, "No active ride. Request a ride.");
        break;
      }

      await send(
        jid,
        `
*Complete Ride?*

Fare: *N${activeRide.fare.toFixed(2)}*
Driver: *${activeRide.driver.name}*

Reply *YES* to complete and release funds.
  `.trim()
      );

      userState.set(jid, {
        step: "confirm_complete_ride",
        data: { rideId: activeRide.id },
      });
      break;
    }
    default: {
      await send(jid, "Invalid. Type *!help*");
    }
  }
}

/* ---------- FORM ---------- */
async function handleForm(jid, text, phone, sender) {
  const state = userState.get(jid);
  if (!state) return; // safety

  const data = state.data;

  switch (state.step) {
    case "reg_name": {
      data.name = text;
      state.step = "reg_pass";
      await send(jid, "Create *password* (6+ chars):");
      break;
    }
    case "reg_pass": {
      if (text.length < 6) {
        await send(jid, "Too short.");
        break;
      }
      userState.delete(jid); // ← clear before API
      try {
        const api = new UberAPI(jid);
        const res = await api.register({ ...data, password: text });
        console.log(data);
        await send(jid, `Registered! *${res.user.name}*\nSend Login.`);
      } catch (err) {
        await send(jid, `Error: ${err.response?.data?.error || err.message}`);
        userState.set(jid, { step: "reg_pass", data });
      }
      break;
    }
    case "login_pass": {
      userState.delete(jid); // ← CLEAR STATE FIRST
      try {
        const api = new UberAPI(jid);
        const res = await api.login({
          phone: data.phone,
          name: sender,
          emergency_type: "",
        });
        await send(jid, `Logged in: *${res.user.name}* (${res.user.role})`);
      } catch (err) {
        await send(jid, `Failed: ${err.response?.data?.error || err.message}`);
        userState.set(jid, { step: "login_pass", data: { phone: data.phone } });
        await send(jid, "Try again. Enter *password*:");
      }
      break;
    }
    case "deposit_amount": {
      const amount = parseFloat(text);
      if (isNaN(amount) || amount < 1000) {
        await send(jid, "Invalid amount. Minimum *N1000*.");
        break;
      }

      const api = new UberAPI(jid);
      if (!api.getToken()) {
        await send(jid, "Login required. please login.");
        userState.delete(jid);
        break;
      }

      try {
        const payment = await api.deposit(amount);
        await send(
          jid,
          `
*Deposit: N${amount.toFixed(2)}*

Click to pay:
${payment.data.authorization_url}

After payment, check balance to confirm.
    `.trim()
        );

        userState.delete(jid);
      } catch (err) {
        await send(
          jid,
          `Payment failed: ${err.response?.data?.error || err.message}`
        );
        userState.delete(jid);
      }
      break;
    }
    // === WITHDRAW AMOUNT ===
    case "withdraw_amount": {
      const amount = parseFloat(text);
      if (isNaN(amount) || amount < 1000) {
        await send(jid, "Invalid. Minimum *N1000*");
        break;
      }

      const api = new UberAPI(jid);
      const balance = await api.getBalance();
      if (amount > balance.balance) {
        await send(jid, "Insufficient balance.");
        break;
      }

      try {
        await api.requestWithdrawal(amount);
        await send(
          jid,
          `
*Withdrawal Requested*

Amount: *N${amount.toFixed(2)}*
Status: *Pending Admin Approval*

    `.trim()
        );
        userState.delete(jid);
      } catch (err) {
        await send(jid, `Error: ${err.response?.data?.error || err.message}`);
      }
      break;
    }
    case "confirm_complete_ride": {
      if (text.trim().toUpperCase() !== "YES") {
        await send(jid, "Ride completion cancelled.");
        userState.delete(jid);
        break;
      }

      const { rideId } = userState.get(jid).data;
      const api = new UberAPI(jid);

      try {
        const result = await api.completeRide(rideId);

        await send(
          jid,
          `
*RIDE COMPLETED!*

Fare: *N${result.fare.toFixed(2)}*
    `.trim()
        );
        // Driver Earned: *N${result.driverEarned.toFixed(2)}* (80%)
        // Company Fee: *N${result.companyFee.toFixed(2)}* (20%)

        // Driver balance updated.
        userState.delete(jid);
      } catch (err) {
        await send(jid, `Error: ${err.response?.data?.error || err.message}`);
      }
      break;
    }
    case "accept_ride_number": {
      const num = parseInt(text.trim());
      const state = userState.get(jid);
      const { rides } = state.data;

      if (isNaN(num) || num < 1 || num > rides.length) {
        await send(jid, "Invalid number.");
        break;
      }

      const ride = rides[num - 1];

      await send(
        jid,
        `
*EMERGENCY RIDE SELECTED*

Ride #${ride.id}
Patient: *${ride.passenger.name}*
Pickup: ${ride.pickup_lat || "GPS Location"}

Send the hospital GPS pin now to accept the ride.
    `.trim()
      );

      userState.set(jid, {
        step: "medical_agent_waiting_for_hospital_gps",
        data: {
          rideId: ride.id,
          pickuplat: ride.pickup_lat,
          pickuplng: ride.pickup_lng,
          passengerName: ride.passenger.name,
        },
      });

      break;
    }
  }
}

/* ==================== SERVER ==================== */
app.get("/", (req, res) => res.send("IdanBot is running"));
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server on port ${PORT}`));
