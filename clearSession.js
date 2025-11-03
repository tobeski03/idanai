// clearSession.js
require("dotenv").config();
const { MongoClient } = require("mongodb");

(async () => {
  const client = new MongoClient(process.env.MONGO_URI);
  try {
    await client.connect();
    const db = client.db("idanbot");
    const sessions = db.collection("sessions");
    const r = await sessions.deleteOne({ _id: "baileys-session" });
    console.log("Deleted:", r.deletedCount);
  } finally {
    await client.close();
  }
})();
