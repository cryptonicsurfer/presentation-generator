'use client';

import { useState, useRef, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Send, User, Bot, Loader2, Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';

export type Message = {
    role: 'user' | 'assistant';
    content: string;
    timestamp: number;
};

interface ChatInterfaceProps {
    messages: Message[];
    onSendMessage: (message: string) => void;
    isTweaking: boolean;
    disabled?: boolean;
}

export function ChatInterface({ messages, onSendMessage, isTweaking, disabled }: ChatInterfaceProps) {
    const [input, setInput] = useState('');
    const scrollRef = useRef<HTMLDivElement>(null);
    const textareaRef = useRef<HTMLTextAreaElement>(null);

    // Auto-scroll to bottom when messages change
    useEffect(() => {
        if (scrollRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
    }, [messages]);

    const handleSubmit = () => {
        if (!input.trim() || isTweaking || disabled) return;
        onSendMessage(input);
        setInput('');
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSubmit();
        }
    };

    return (
        <div className="flex flex-col h-[500px] border rounded-lg bg-background shadow-sm overflow-hidden">
            {/* Header */}
            <div className="p-4 border-b bg-muted/30 flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-primary" />
                <h3 className="font-semibold text-sm">AI Presentation Assistant</h3>
            </div>

            {/* Messages Area */}
            <div
                ref={scrollRef}
                className="flex-1 overflow-y-auto p-4 space-y-4 scroll-smooth"
            >
                {messages.length === 0 ? (
                    <div className="h-full flex flex-col items-center justify-center text-muted-foreground text-sm p-8 text-center opacity-60">
                        <Bot className="w-12 h-12 mb-4 opacity-20" />
                        <p>Ask me to change anything in the presentation.</p>
                        <p className="text-xs mt-2">"Change slide 2 title to..."</p>
                        <p className="text-xs">"Make all headers blue..."</p>
                    </div>
                ) : (
                    messages.map((msg, i) => (
                        <div
                            key={i}
                            className={cn(
                                "flex gap-3 max-w-[85%]",
                                msg.role === 'user' ? "ml-auto flex-row-reverse" : "mr-auto"
                            )}
                        >
                            <div className={cn(
                                "w-8 h-8 rounded-full flex items-center justify-center shrink-0",
                                msg.role === 'user' ? "bg-primary text-primary-foreground" : "bg-muted"
                            )}>
                                {msg.role === 'user' ? <User className="w-4 h-4" /> : <Bot className="w-4 h-4" />}
                            </div>
                            <div className={cn(
                                "p-3 rounded-lg text-sm whitespace-pre-wrap",
                                msg.role === 'user'
                                    ? "bg-primary text-primary-foreground rounded-tr-none"
                                    : "bg-muted text-foreground rounded-tl-none"
                            )}>
                                {msg.content}
                            </div>
                        </div>
                    ))
                )}

                {isTweaking && (
                    <div className="flex gap-3 mr-auto max-w-[85%]">
                        <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center shrink-0">
                            <Bot className="w-4 h-4" />
                        </div>
                        <div className="bg-muted text-foreground p-3 rounded-lg rounded-tl-none flex items-center gap-2 text-sm">
                            <Loader2 className="w-3 h-3 animate-spin" />
                            Thinking...
                        </div>
                    </div>
                )}
            </div>

            {/* Input Area */}
            <div className="p-4 border-t bg-background">
                <div className="relative">
                    <Textarea
                        ref={textareaRef}
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        onKeyDown={handleKeyDown}
                        placeholder={disabled ? "Generate a presentation first..." : "Type your request..."}
                        disabled={disabled || isTweaking}
                        className="min-h-[60px] pr-12 resize-none"
                        rows={2}
                    />
                    <Button
                        size="icon"
                        className="absolute right-2 bottom-2 h-8 w-8"
                        onClick={handleSubmit}
                        disabled={!input.trim() || isTweaking || disabled}
                    >
                        <Send className="w-4 h-4" />
                    </Button>
                </div>
                <div className="text-xs text-muted-foreground mt-2 text-center">
                    Tip: You can refer to specific slides (e.g., "slide 3")
                </div>
            </div>
        </div>
    );
}
