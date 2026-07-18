import { useState } from "react";
import { Button } from "~/components/ui/button";
import { Card } from "~/components/ui/card";

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
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-b from-slate-900 to-slate-800 p-4">
      <Card className="w-full max-w-md">
        <div className="p-8 space-y-6">
          <div className="text-center">
            <h1 className="text-3xl font-bold text-amber-700">Click Hunter</h1>
            <p className="text-sm text-slate-600 mt-2">
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
                className="w-full px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-700"
              />
            </div>

            <Button
              type="submit"
              disabled={!name.trim() || isLoading}
              className="w-full bg-amber-700 hover:bg-amber-800"
            >
              {isLoading ? "Creating..." : "Start Adventure"}
            </Button>
          </form>
        </div>
      </Card>
    </div>
  );
}
