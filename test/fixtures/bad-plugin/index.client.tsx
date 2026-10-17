import { Counter } from "./client/counter";

export default function contribute(client: { addCommandCenterItem(item: object): () => void }) {
  new Counter();
  return client.addCommandCenterItem({ id: "bad", title: "Bad", icon: "NotARealIconName", onSelect: () => {} });
}
