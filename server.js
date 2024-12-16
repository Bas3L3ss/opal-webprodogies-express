const { Server } = require("socket.io");
const fs = require("fs");
const express = require("express");
const cors = require("cors");
const http = require("http");
const app = express();
const dotenv = require("dotenv");
const { Readable } = require("stream");
const axios = require("axios");
const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");
const OpenAi = require("openai");

dotenv.config();

const server = http.createServer(app);

app.use(cors());

const io = new Server(server, {
  cors: {
    origin: process.env.NEXT_ELECTRON_HOST,
    methods: ["GET", "POST"],
  },
});

const s3 = new S3Client({
  credentials: {
    accessKeyId: process.env.ACCESS_KEY,
    secretAccessKey: process.env.SECRET_KEY,
  },
  region: process.env.BUCKET_REGION,
});

const openai = new OpenAi({
  apiKey: process.env.OPEN_AI_KEY,
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
    recordedChunks = [];
    fs.readFile("temp_upload/" + data.filename, async (err, file) => {
      const processing = await axios.post(
        `${process.env.NEXT_API_HOST}recording/${data.userId}/processing`,
        {
          filename: data.filename,
        }
      );
      if (processing.data.status !== 200)
        return console.log(
          "ERROR SOMETHING WENT WRONG WITH CREATING THE PROCESSING FILE"
        );
      const Key = data.filename;
      const Bucket = process.env.BUCKET_NAME;
      const ContentType = "video/webm";
      const command = new PutObjectCommand({
        Key,
        Bucket,
        ContentType,
        Body: file,
      });

      const fileStatus = await s3.send(command);

      if (fileStatus["$metadata"].httpStatusCode == 200) {
        console.log("Video updated to AWS ");

        if (processing.data.plan === "PRO") {
          fs.stat(`temp_upload/${data.filename}`, async (err, stat) => {
            if (!err) {
              // whisper 25mb
              if (stat.size < 25000000) {
                const transcription = await openai.audio.transcriptions.create({
                  file: fs.createReadStream(`temp_upload/${data.filename}`),
                  model: "whisper-1",
                  response_format: "text",
                });

                if (transcription) {
                  const completion = await openai.chat.completions.create({
                    model: "gpt-3.5-turbo",
                    response_format: { type: "json_object" },
                    messages: [
                      {
                        role: "system",
                        content: `You are going to generate a title and a nice description using the speech to text transcription (${transcription}) and then return it in json format as {"title":<the title you gave>,"summary":<the summary you created> }`,
                      },
                    ],
                  });

                  const titleAndSummeryGenerated = await axios.post(
                    `${process.env.NEXT_API_HOST}recording/${data.userId}/transcribe`,
                    {
                      filename: data.filename,
                      content: completion.choices[0].message.content,
                      transcript: transcription,
                    }
                  );

                  if (titleAndSummeryGenerated.data.status !== 200) {
                    console.log(
                      "ERROR SOMETHING WENT WRONG WITH CREATING THE PROCESSING FILE"
                    );
                  }
                }
              }
            }
          });
        }
        const stopProcessing = await axios.post(
          `${process.env.NEXT_API_HOST}recording/${data.userId}/complete`,
          {
            filename: data.filename,
          }
        );
        if (stopProcessing.status !== 200) {
          console.log("SOMETHING WENT WRONG DURING STOP PROCESSING");
        }
        if (stopProcessing.status === 200) {
          fs.unlink(`temp_upload/${data.filename}`, (err) => {
            if (!err) {
              console.log(`${data.filename} deleted successfully`);
            }
          });
        }
      } else {
        console.log("ERROR, UPLOAD FAILED! PROCESS ABORTED");
      }
    });
  });
  socket.on("disconnect", async (data) => {
    console.log("Socket.id is disconnected ", socket.id);
  });
});

server.listen(5001, () => {
  console.log("Listening to port 5001");
});
