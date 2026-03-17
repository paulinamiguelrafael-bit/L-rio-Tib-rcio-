import express from "express";
import { createServer } from "http";
import { WebSocketServer, WebSocket } from "ws";
import { v4 as uuidv4 } from "uuid";
import path from "path";
import { createServer as createViteServer } from "vite";

async function startServer() {
  const app = express();
  const server = createServer(app);
  const wss = new WebSocketServer({ server });
  const PORT = 3000;

  app.use(express.json());

  // In-memory state
  const rides = [];
  const users = new Map(); // userId -> { ws, name, location, ratings: [] }
  const chats = new Map(); // rideId -> messages[]
  const reviews = []; // { rideId, reviewerId, revieweeId, rating, comment, timestamp }

  wss.on("connection", (ws) => {
    const userId = uuidv4();
    users.set(userId, { ws, name: `User ${userId.slice(0, 4)}`, ratings: [] });

    ws.send(JSON.stringify({ type: "init", userId, name: users.get(userId).name }));

    ws.on("message", (data) => {
      try {
        const message = JSON.parse(data.toString());
        
        switch (message.type) {
          case "create_ride":
            const newRide = {
              id: uuidv4(),
              creatorId: userId,
              creatorName: users.get(userId).name,
              origin: message.origin,
              destination: message.destination,
              time: message.time,
              seats: message.seats,
              passengers: [userId],
              status: "open",
              rideType: message.rideType || "private", // private, taxi, yango, uber
              price: message.price || 0,
              earnings: {
                driver: (message.price || 0) * 0.2,
                founder: (message.price || 0) * 0.8
              }
            };
            rides.push(newRide);
            broadcast({ type: "ride_created", ride: newRide });
            break;

          case "emergency_alert":
            const emergencyRide = rides.find(r => r.id === message.rideId);
            if (emergencyRide && emergencyRide.passengers.includes(userId)) {
              // Broadcast emergency to all participants in the ride
              emergencyRide.passengers.forEach(pId => {
                const user = users.get(pId);
                if (user && user.ws && user.ws.readyState === WebSocket.OPEN) {
                  user.ws.send(JSON.stringify({ 
                    type: "sos_alert", 
                    rideId: message.rideId, 
                    senderName: users.get(userId).name,
                    location: message.location 
                  }));
                }
              });
            }
            break;

          case "join_ride":
            const ride = rides.find(r => r.id === message.rideId);
            if (ride && ride.passengers.length < ride.seats && !ride.passengers.includes(userId)) {
              ride.passengers.push(userId);
              broadcast({ type: "ride_updated", ride });
            }
            break;

          case "complete_ride":
            const rideToComplete = rides.find(r => r.id === message.rideId && r.creatorId === userId);
            if (rideToComplete) {
              rideToComplete.status = "completed";
              broadcast({ type: "ride_updated", ride: rideToComplete });
            }
            break;

          case "submit_review":
            const { rideId, revieweeId, rating, comment } = message;
            const targetRide = rides.find(r => r.id === rideId);
            if (targetRide && targetRide.status === "completed" && targetRide.passengers.includes(userId) && targetRide.passengers.includes(revieweeId)) {
              const newReview = {
                id: uuidv4(),
                rideId,
                reviewerId: userId,
                revieweeId,
                rating,
                comment,
                timestamp: new Date().toISOString()
              };
              reviews.push(newReview);
              
              // Update user's average rating
              const reviewee = users.get(revieweeId);
              if (reviewee) {
                reviewee.ratings.push(rating);
              }
              
              broadcast({ type: "review_submitted", review: newReview });
            }
            break;

          case "chat_message":
            const chatRideId = message.rideId;
            if (!chats.has(chatRideId)) chats.set(chatRideId, []);
            const chatMsg = {
              id: uuidv4(),
              senderId: userId,
              senderName: users.get(userId).name,
              text: message.text,
              timestamp: new Date().toISOString()
            };
            chats.get(chatRideId).push(chatMsg);
            
            // Broadcast to ride participants
            const activeTargetRide = rides.find(r => r.id === chatRideId);
            if (activeTargetRide) {
              activeTargetRide.passengers.forEach(pId => {
                const user = users.get(pId);
                if (user && user.ws.readyState === WebSocket.OPEN) {
                  user.ws.send(JSON.stringify({ type: "new_message", rideId: chatRideId, message: chatMsg }));
                }
              });
            }
            break;
        }
      } catch (e) {
        console.error("WS Error:", e);
      }
    });

    ws.on("close", () => {
      // We keep the user data for ratings even if they disconnect, 
      // but we remove the socket
      const user = users.get(userId);
      if (user) user.ws = null;
    });
  });

  function broadcast(data) {
    const payload = JSON.stringify(data);
    users.forEach(user => {
      if (user && user.ws && user.ws.readyState === WebSocket.OPEN) {
        user.ws.send(payload);
      }
    });
  }

  // API Routes
  app.get("/api/rides", (req, res) => {
    res.json(rides);
  });

  app.get("/api/chats/:rideId", (req, res) => {
    res.json(chats.get(req.params.rideId) || []);
  });

  app.get("/api/reviews/:userId", (req, res) => {
    const userReviews = reviews.filter(r => r.revieweeId === req.params.userId);
    res.json(userReviews);
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  server.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
