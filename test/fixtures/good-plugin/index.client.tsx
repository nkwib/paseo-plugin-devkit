import { Greeting } from "./client/greeting";

export default function contribute(client: { addCommandCenterItem(item: object): () => void; addScreen(screen: object): () => void }) {
  const off = client.addCommandCenterItem({ id: "hello", title: "Say hello", icon: "Hand", onSelect: () => {} });
  const offScreen = client.addScreen({ id: "hello", title: "Hello", icon: "MessageCircle", component: Greeting });
  return () => {
    off();
    offScreen();
  };
}
