/**
 * Icon name string → Lucide React component lookup.
 * Used by the Sidebar to render API-driven navigation items.
 */
import {
  LayoutDashboard, Bot, Users, AlertTriangle, ScrollText, Layers,
  GitBranch, TrendingUp, ShieldCheck, BarChart3, BookOpen, Eye,
  Mail, Settings, MessageSquare, CreditCard, ExternalLink, Globe,
  Database, Key, Shield, Zap, type LucideIcon,
} from 'lucide-react';

const ICON_MAP: Record<string, LucideIcon> = {
  LayoutDashboard,
  Bot,
  Users,
  AlertTriangle,
  ScrollText,
  Layers,
  GitBranch,
  TrendingUp,
  ShieldCheck,
  BarChart3,
  BookOpen,
  Eye,
  Mail,
  Settings,
  MessageSquare,
  CreditCard,
  ExternalLink,
  Globe,
  Database,
  Key,
  Shield,
  Zap,
};

/** Resolve an icon name string to a Lucide component. Falls back to Layers. */
export function getIcon(name: string): LucideIcon {
  return ICON_MAP[name] ?? Layers;
}
