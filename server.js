const { Server } = require("socket.io");
const fs = require("fs");
const express = require("express");
const cors = require("cors");
const http = require("http");
const app = express();
const dotenv = require("dotenv");
const { Readable } = require("stream");

dotenv.config();

const server = http.createServer(app);

app.use(cors());

const io = new Server(server, {
  cors: {
    origin: process.env.NEXT_ELECTRON_HOST,
    methods: ["GET", "POST"],
  },
});

let recordedChunks = [];

io.on("connection", (socket) => {
  console.log("Socket is Connected");

  socket.on("video-chunks", async (data) => {
    console.log("Video chunk is sent", data);
    const writeStream = fs.createWriteStream(`temp_upload/${data.filename}`);
    recordedChunks.push(data.chunks);

    const videoBlob = new Blob(recordedChunks, {
      type: "video/webm; codecs=vp9",
    });

    const buffer = Buffer.from(await videoBlob.arrayBuffer());
    const readStream = Readable.from(buffer);
    readStream.pipe(writeStream).on("finish", () => {
      console.log("Chunk saved", data);
    });
  });
  socket.on("process-video", async (data) => {
    console.log("Processing video...", data);
  });
  socket.on("disconnect", async (data) => {
    console.log("Socket.id is disconnected ", socket.id);
  });
});

server.listen(5001, () => {
  console.log("Listening to port 5001");
});
