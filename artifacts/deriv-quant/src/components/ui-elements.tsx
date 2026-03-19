import React from "react";
import { cn } from "@/lib/utils";
import { Loader2 } from "lucide-react";

export function Card({ className, children, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn("glass-panel rounded-xl overflow-hidden flex flex-col", className)} {...props}>
      {children}
    </div>
  );
}

export function CardHeader({ className, children, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn("px-6 py-4 border-b border-border/50 flex flex-row items-center justify-between", className)} {...props}>
      {children}
    </div>
  );
}

export function CardTitle({ className, children, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h3 className={cn("text-sm font-medium text-muted-foreground uppercase tracking-wider", className)} {...props}>
      {children}
    </h3>
  );
}

export function CardContent({ className, children, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn("p-6 flex-1", className)} {...props}>
      {children}
    </div>
  );
}

export function MetricValue({ 
  value, 
  label, 
  trend, 
  prefix = "", 
  suffix = "",
  mono = true,
  isCurrency = false
}: { 
  value: React.ReactNode; 
  label?: string; 
  trend?: "up" | "down" | "neutral";
  prefix?: string;
  suffix?: string;
  mono?: boolean;
  isCurrency?: boolean;
}) {
  return (
    <div className="flex flex-col gap-1">
      {label && <span className="text-xs text-muted-foreground uppercase tracking-wider">{label}</span>}
      <div className="flex items-baseline gap-1">
        <span className={cn(
          "text-2xl lg:text-3xl font-bold tracking-tight text-foreground",
          mono && "font-mono",
          trend === "up" && "text-success",
          trend === "down" && "text-destructive"
        )}>
          {prefix}{value}{suffix}
        </span>
      </div>
    </div>
  );
}

export function Badge({ 
  children, 
  variant = "default",
  className 
}: { 
  children: React.ReactNode; 
  variant?: "default" | "success" | "destructive" | "warning" | "outline";
  className?: string;
}) {
  return (
    <span className={cn(
      "inline-flex items-center px-2 py-0.5 rounded text-xs font-medium uppercase tracking-wider",
      variant === "default" && "bg-primary/10 text-primary border border-primary/20",
      variant === "success" && "bg-success/10 text-success border border-success/20",
      variant === "destructive" && "bg-destructive/10 text-destructive border border-destructive/20",
      variant === "warning" && "bg-warning/10 text-warning border border-warning/20",
      variant === "outline" && "border border-border text-muted-foreground",
      className
    )}>
      {children}
    </span>
  );
}

export function Button({ 
  children, 
  variant = "default", 
  size = "md",
  isLoading = false,
  className,
  ...props 
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { 
  variant?: "default" | "primary" | "destructive" | "outline" | "ghost";
  size?: "sm" | "md" | "lg";
  isLoading?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      className={cn(
        "inline-flex items-center justify-center font-medium rounded-lg transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-primary/50 disabled:opacity-50 disabled:cursor-not-allowed",
        size === "sm" && "px-3 py-1.5 text-xs",
        size === "md" && "px-4 py-2 text-sm",
        size === "lg" && "px-6 py-3 text-base",
        variant === "default" && "bg-accent text-accent-foreground hover:bg-accent/80",
        variant === "primary" && "bg-primary text-primary-foreground shadow-lg shadow-primary/20 hover:bg-primary/90",
        variant === "destructive" && "bg-destructive text-destructive-foreground shadow-lg shadow-destructive/20 hover:bg-destructive/90",
        variant === "outline" && "border border-border hover:bg-muted/50 text-foreground",
        variant === "ghost" && "hover:bg-muted text-muted-foreground hover:text-foreground",
        className
      )}
      disabled={props.disabled || isLoading}
      {...props}
    >
      {isLoading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
      {children}
    </button>
  );
}

export function Input({ className, ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        "flex h-10 w-full rounded-md border border-border bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
      {...props}
    />
  );
}

export function Label({ className, ...props }: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return (
    <label
      className={cn(
        "text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 text-muted-foreground",
        className
      )}
      {...props}
    />
  );
}

export function Select({ className, children, ...props }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={cn(
        "flex h-10 w-full rounded-md border border-border bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 appearance-none",
        className
      )}
      {...props}
    >
      {children}
    </select>
  );
}
