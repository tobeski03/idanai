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

// ssh -i ./idanai_key.pem azureuser@104.214.180.132
