import "./_env";
import { getStore } from "@/lib/store";

getStore()
  .reset()
  .then(() => console.log("store reset"))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
