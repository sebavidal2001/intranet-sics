import { render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it } from "vitest"
import { ChatAI } from "@/components/portali/preventivatore/chat-ai"
import { installaFetchFinta, preparaDomTest, registraResilienzaFetch } from "./helpers/fetch-finta"

describe("render Chat AI", () => {
  beforeEach(preparaDomTest)
  it("disegna il riepilogo utilizzo con null", async () => {
    installaFetchFinta([{ url: "/api/portali/preventivatore/usage", risposta: { enabled: true, currency: "USD", today: null, last_30_days: null, session: null } }])
    render(<ChatAI contesto="archivio" placeholder="Chiedi ai preventivi" />)
    expect(await screen.findByPlaceholderText("Chiedi ai preventivi")).toBeInTheDocument()
    expect(screen.queryByText(/^Crash:/)).not.toBeInTheDocument()
  })
  registraResilienzaFetch("Chat", () => <ChatAI contesto="archivio" />)
})
