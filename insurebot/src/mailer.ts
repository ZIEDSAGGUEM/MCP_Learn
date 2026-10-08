import nodemailer from "nodemailer";
import { config } from "./config.js";

// In the lab every email lands in Mailpit (http://localhost:8025), so nothing really leaves the laptop.
const transport = nodemailer.createTransport(config.smtpUrl);

export async function sendMail(to: string, subject: string, text: string) {
  await transport.sendMail({ from: "InsureBot <quotes@insurebot.test>", to, subject, text });
}
