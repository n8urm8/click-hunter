import { useState } from "react";
import { Button } from "~/components/ui/button";
import { Card } from "~/components/ui/card";
import { Fireflies } from "~/components/ui/fireflies";
import { ThemeToggle } from "~/components/ui/theme-toggle";

interface NameEntryProps {
  onSubmit: (name: string) => Promise<void>;
  isLoading: boolean;
}

export function NameEntry({ onSubmit, isLoading }: NameEntryProps) {
  const [name, setName] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (name.trim()) {
      await onSubmit(name.trim());
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center forest-bg relative p-4">
      <Fireflies count={30} />
      <ThemeToggle />
      <Card className="w-full max-w-md forest-card box-glow-gold relative z-10">
        <div className="p-8 space-y-6">
          <div className="text-center">
            <h1 className="text-4xl font-heading text-gold glow-gold">Click Hunter</h1>
            <div className="flex justify-center my-3">
              <span className="text-forest-glow/40 text-sm tracking-[0.5em]">~ ✧ ✦ ✧ ~</span>
            </div>
            <p className="text-sm text-muted-foreground mt-2">
              Welcome, adventurer. Choose your name.
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <input
                type="text"
                placeholder="Enter your name..."
                value={name}
                onChange={(e) => setName(e.target.value)}
                disabled={isLoading}
                maxLength={30}
                autoFocus
                className="w-full px-4 py-3 bg-forest-dark/50 dark:bg-forest-dark/80 border border-forest-light/40 rounded-lg text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-gold/50 focus:border-gold/40"
              />
            </div>

            <Button
              type="submit"
              disabled={!name.trim() || isLoading}
              className="w-full bg-forest-mid hover:bg-forest-light text-gold-light border border-gold/20 btn-enchanted"
            >
              {isLoading ? "Entering the forest..." : "⚔ Begin Your Quest"}
            </Button>
          </form>
        </div>
      </Card>
    </div>
  );
}
