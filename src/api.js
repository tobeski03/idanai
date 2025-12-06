// src/api.js
const axios = require("axios");
const fs = require("fs");
const path = require("path");

const API_BASE_URL = "http://localhost:8000";
const TOKEN_FILE = path.join(__dirname, "..", "user_tokens.json");

function loadAllTokens() {
  try {
    return fs.existsSync(TOKEN_FILE)
      ? JSON.parse(fs.readFileSync(TOKEN_FILE, "utf8"))
      : {};
  } catch {
    return {};
  }
}
function saveAllTokens(tokens) {
  fs.writeFileSync(TOKEN_FILE, JSON.stringify(tokens, null, 2));
}
const allTokens = loadAllTokens();

class UberAPI {
  constructor(jid) {
    this.jid = jid;
    const saved = allTokens[jid];
    this.token = saved?.token || null;
    this.userId = saved?.userId || null;

    this.client = axios.create({
      baseURL: `${API_BASE_URL}/api`,
      timeout: 10_000,
      headers: { "Content-Type": "application/json" },
    });

    // add token to every request
    this.client.interceptors.request.use((cfg) => {
      if (this.token) cfg.headers.Authorization = `Bearer ${this.token}`;
      return cfg;
    });

    // clear token only on real 401 (skip login endpoint)
    this.client.interceptors.response.use(
      (res) => res,
      (err) => {
        if (
          err.response?.status === 401 &&
          !err.config.url.includes("/auth/login")
        ) {
          this.clearToken();
          console.log(`[jid:${this.jid}] Session expired`);
        }
        return Promise.reject(err);
      }
    );
  }

  saveToken(token, userId) {
    this.token = token;
    this.userId = userId;
    allTokens[this.jid] = { token, userId };
    saveAllTokens(allTokens);
  }
  getToken() {
    return this.token || null;
  }
  getUserId() {
    return this.userId || null;
  }
  clearToken() {
    this.token = null;
    this.userId = null;
    delete allTokens[this.jid];
    saveAllTokens(allTokens);
  }

  /* AUTH */
  async login({ phone, name = null, emergency_type = null }) {
    // New passwordless login: phone + optional name and emergency_type
    const body = { phone };
    if (name) body.name = name;
    if (emergency_type) body.emergency_type = emergency_type;

    const res = await this.client.post("/auth/login", body);
    const { token, user } = res.data;
    // Save token locally for this jid
    this.saveToken(token, user.id);
    return res.data;
  }
  async register({ phone, name, password, role = "user" }) {
    const res = await this.client.post("/auth/register", {
      phone,
      name,
      password,
      role,
    });
    const { token, user } = res.data;
    this.saveToken(token, user.id);
    return res.data;
  }

  /* RIDES */
  // async requestRide({ pickup_lat, pickup_lng, dropoff_lat, dropoff_lng }) {
  //   const res = await this.client.post("/rides/request", {
  //     pickup_lat,
  //     pickup_lng,
  //     dropoff_lat,
  //     dropoff_lng,
  //   });
  //   return res.data;
  // }
  async requestRide(payload) {
    const res = await this.client.post("/rides/request", {
      ...payload,
      passengerId: this.getUserId(),
    });
    return res.data;
  }
  async getRide(rideId) {
    const res = await this.client.get(`/rides/${rideId}`);
    return res.data;
  }
  async cancelRide(rideId) {
    const res = await this.client.post(`/rides/${rideId}/cancel`);
    return res.data;
  }
  async getMyRides() {
    const res = await this.client.get("/rides");
    return res.data;
  }
  async acceptRide(rideId, locationData = {}) {
    return this.client.post(`/rides/${rideId}/accept`, locationData);
    // Backend must allow: dropoff_lat, dropoff_lng, dropoff_address
  }
  async getAvailableRides() {
    const res = await this.client.get("/rides/available");
    return res.data;
  }
  async updateLocation({ lat, lng, available = true }) {
    const res = await this.client.put("/users/location", {
      lat,
      lng,
      available,
    });
    return res.data;
  }
  async getBalance() {
    const res = await this.client.get("/rides/balance");
    return res.data;
  }
  async deposit(amount) {
    const res = await this.client.post("/rides/deposit", { amount });
    return res.data;
  }
  async getBalance() {
    const res = await this.client.get("/rides/balance");
    return res.data;
  }

  async releaseFunds(amount) {
    const res = await this.client.post("/rides/release", { amount });
    return res.data;
  }

  async requestWithdrawal(amount) {
    const res = await this.client.post("/rides/withdraw", { amount });
    return res.data;
  }
  async getTransactions() {
    let id = this.getUserId();
    console.log(id);
    const res = await this.client.get("/transactions/transaction", {
      user: id,
    });
    return res.data;
  }
  async getProfile() {
    const res = await this.client.get("/rides/profile");
    return res.data;
  }
  async completeRide(rideId) {
    const res = await this.client.post(`/rides/${rideId}/complete`);
    return res.data;
  }
}
module.exports = { UberAPI };
