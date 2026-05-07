import "./styles/main.css";
import { ClassroomApp } from "./app/ClassroomApp";
import { experiences } from "./experiences";

const root = document.querySelector<HTMLElement>("#app");

if (!root) {
  throw new Error("Missing #app root element.");
}

const app = new ClassroomApp(root, experiences);
app.start();
