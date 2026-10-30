import { bootstrapApplication } from "./foundation/bootstrap.js";
import "./foundation/global.css";

const rootElement = document.querySelector<HTMLElement>("#root");
if (rootElement === null) {
  throw new Error("Muses root element was not found");
}

void bootstrapApplication(rootElement);
