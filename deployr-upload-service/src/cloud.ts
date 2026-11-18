import { Upload } from "@aws-sdk/lib-storage";
import { S3Client } from "@aws-sdk/client-s3";
import fs from "fs";
import dotenv from "dotenv";

dotenv.config();

const accessKeyId: string = process.env.accessKeyId!;
const secretAccessKey: string = process.env.secretAccessKey!;
const endpoint: string = process.env.endpoint!;

const s3 = new S3Client({
  region: "auto",
  endpoint,
  credentials: {
    accessKeyId,
    secretAccessKey,
  },
})

export const uploadFile = async (fileName: string, localFilePath: string) => {
  const fileContent = fs.readFileSync(localFilePath);
  const response = await new Upload({
    client: s3,
    params: {
      Body: fileContent,
      Bucket: "deployr",
      Key: fileName,
    },
  }).done();
  console.log(response);
}
