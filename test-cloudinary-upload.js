const { v2: cloudinary } = require("cloudinary");
const fs = require("fs");

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
  secure: true,
});

console.log({
  cloud: process.env.CLOUDINARY_CLOUD_NAME,
  key: process.env.CLOUDINARY_API_KEY,
  secretLength: process.env.CLOUDINARY_API_SECRET?.length,
});

cloudinary.uploader.upload(
  "certificados-generados/ponente-4c57c56c-a28b-48dd-8b14-2ae7b6183c13.pdf",
  {
    resource_type: "raw",
    folder: "congreso/certificados-test",
    public_id: "test-certificado-zury",
  },
  (error, result) => {
    if (error) {
      console.error("ERROR:", error);
      process.exit(1);
    }

    console.log("OK:", result.secure_url);
  },
);