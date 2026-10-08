//+------------------------------------------------------------------+
//|                                                   BarReplay.mq5  |
//|  TradingView-style Bar Replay for MetaTrader 5 (any broker)      |
//|                                                                  |
//|  HOW IT WORKS                                                    |
//|  1. Attach to a chart of the symbol you want to replay (e.g.     |
//|     GOLD). Set the start time in the inputs.                     |
//|  2. It creates a custom symbol "<SYMBOL>_REPLAY", loads history  |
//|     up to your start time, and opens a replay chart.             |
//|  3. Use the buttons at the bottom-left of the replay chart:      |
//|     Play/Pause, Next candle, Slower, Faster.                     |
//|  Add your indicators (UT Bot etc.) to the replay chart normally. |
//|  You can change the replay chart's timeframe at any time.        |
//|  If you use InpTemplate, save that template WITHOUT this EA.     |
//+------------------------------------------------------------------+
#property copyright "BarReplay"
#property version   "1.00"
#property description "Bar replay: Play/Pause, Next candle, speed control"

input datetime        InpStart       = D'2026.09.01 08:00'; // Replay start (bars after this are hidden)
input int             InpHistoryDays = 20;                  // Days of history visible before start
input int             InpReplayDays  = 10;                  // Days available to replay
input ENUM_TIMEFRAMES InpChartTF     = PERIOD_M5;           // Replay chart timeframe
input string          InpTemplate    = "";                  // Optional template, e.g. "mysetup.tpl"

string   g_sym      = "";
long     g_chart    = 0;
MqlRates g_future[];
int      g_pos      = 0;
int      g_speeds[] = {3000, 1500, 800, 400, 200, 80, 25}; // ms per 1-minute bar while playing
int      g_speedIdx = 3;
uint     g_lastStep = 0;

//+------------------------------------------------------------------+
long FindChart(const string sym)
{
   long id = ChartFirst();
   while(id >= 0)
   {
      if(ChartSymbol(id) == sym) return id;
      id = ChartNext(id);
   }
   return 0;
}

//+------------------------------------------------------------------+
bool LoadM1(datetime from, datetime to, MqlRates &arr[])
{
   for(int i = 0; i < 15; i++)
   {
      ResetLastError();
      if(CopyRates(_Symbol, PERIOD_M1, from, to, arr) > 0) return true;
      Sleep(1000); // give the terminal time to download history
   }
   PrintFormat("BarReplay: no M1 history %s -> %s (error %d). Try a newer start date or raise Max bars in chart.",
               TimeToString(from), TimeToString(to), GetLastError());
   return false;
}

//+------------------------------------------------------------------+
void Button(const string name, const string text, int x, int w)
{
   if(ObjectFind(g_chart, name) < 0)
      ObjectCreate(g_chart, name, OBJ_BUTTON, 0, 0, 0);
   ObjectSetInteger(g_chart, name, OBJPROP_CORNER, CORNER_LEFT_LOWER);
   ObjectSetInteger(g_chart, name, OBJPROP_XDISTANCE, x);
   ObjectSetInteger(g_chart, name, OBJPROP_YDISTANCE, 40);
   ObjectSetInteger(g_chart, name, OBJPROP_XSIZE, w);
   ObjectSetInteger(g_chart, name, OBJPROP_YSIZE, 24);
   ObjectSetInteger(g_chart, name, OBJPROP_FONTSIZE, 9);
   ObjectSetInteger(g_chart, name, OBJPROP_BGCOLOR, clrDarkSlateGray);
   ObjectSetInteger(g_chart, name, OBJPROP_COLOR, clrWhite);
   ObjectSetInteger(g_chart, name, OBJPROP_STATE, false);
   ObjectSetInteger(g_chart, name, OBJPROP_SELECTABLE, false);
   ObjectSetString (g_chart, name, OBJPROP_TEXT, text);
}

//+------------------------------------------------------------------+
void Controls()
{
   Button("RP_PLAY", "Play",         10, 70);
   Button("RP_NEXT", "Next candle",  86, 95);
   Button("RP_SLOW", "Slower",      187, 65);
   Button("RP_FAST", "Faster",      258, 65);

   if(ObjectFind(g_chart, "RP_INFO") < 0)
      ObjectCreate(g_chart, "RP_INFO", OBJ_LABEL, 0, 0, 0);
   ObjectSetInteger(g_chart, "RP_INFO", OBJPROP_CORNER, CORNER_LEFT_LOWER);
   ObjectSetInteger(g_chart, "RP_INFO", OBJPROP_ANCHOR, ANCHOR_LEFT_LOWER);
   ObjectSetInteger(g_chart, "RP_INFO", OBJPROP_XDISTANCE, 10);
   ObjectSetInteger(g_chart, "RP_INFO", OBJPROP_YDISTANCE, 48);
   ObjectSetInteger(g_chart, "RP_INFO", OBJPROP_COLOR, clrOrange);
   ObjectSetInteger(g_chart, "RP_INFO", OBJPROP_FONTSIZE, 10);
   ObjectSetInteger(g_chart, "RP_INFO", OBJPROP_SELECTABLE, false);
}

//+------------------------------------------------------------------+
void Info()
{
   int total = ArraySize(g_future);
   string t  = (g_pos > 0) ? TimeToString(g_future[g_pos - 1].time, TIME_DATE | TIME_MINUTES) : "start";
   string s  = StringFormat("REPLAY  %s   |   speed %d/%d   |   %d%% done",
                            t, g_speedIdx + 1, ArraySize(g_speeds),
                            total > 0 ? g_pos * 100 / total : 0);
   ObjectSetString(g_chart, "RP_INFO", OBJPROP_TEXT, s);
}

//+------------------------------------------------------------------+
bool Push(int count)
{
   int total = ArraySize(g_future);
   count = MathMin(count, total - g_pos);
   if(count <= 0) return false;

   MqlRates chunk[];
   ArrayResize(chunk, count);
   for(int i = 0; i < count; i++) chunk[i] = g_future[g_pos + i];

   if(CustomRatesUpdate(g_sym, chunk) < 0)
   {
      PrintFormat("BarReplay: CustomRatesUpdate failed (%d)", GetLastError());
      return false;
   }
   g_pos += count;
   return true;
}

//+------------------------------------------------------------------+
// Reveal the rest of the current candle on whatever timeframe the
// replay chart is showing right now.
void NextCandle()
{
   int total = ArraySize(g_future);
   if(g_pos >= total) return;

   long ps = PeriodSeconds(ChartPeriod(g_chart));
   if(ps <= 0) ps = 60;
   long t0  = (long)g_future[g_pos].time;
   long end = t0 - (t0 % ps) + ps;

   int n = 0;
   while(g_pos + n < total && (long)g_future[g_pos + n].time < end) n++;
   Push(MathMax(n, 1));
}

//+------------------------------------------------------------------+
bool Pressed(const string name)
{
   if(ObjectGetInteger(g_chart, name, OBJPROP_STATE) == 0) return false;
   ObjectSetInteger(g_chart, name, OBJPROP_STATE, false);
   return true;
}

//+------------------------------------------------------------------+
int OnInit()
{
   string base = _Symbol;
   StringReplace(base, "#", "");
   StringReplace(base, ".", "_");
   g_sym = base + "_REPLAY";

   bool isCustom = false;
   if(SymbolExist(g_sym, isCustom))
   {
      if(!isCustom)
      {
         Print("BarReplay: ", g_sym, " already exists as a real symbol");
         return INIT_FAILED;
      }
   }
   else if(!CustomSymbolCreate(g_sym, "Replay", _Symbol))
   {
      PrintFormat("BarReplay: CustomSymbolCreate failed (%d)", GetLastError());
      return INIT_FAILED;
   }

   MqlRates past[];
   if(!LoadM1(InpStart - InpHistoryDays * 86400, InpStart - 1, past)) return INIT_FAILED;
   ArrayFree(g_future);
   if(!LoadM1(InpStart, InpStart + InpReplayDays * 86400, g_future)) return INIT_FAILED;
   g_pos = 0;

   CustomRatesDelete(g_sym, 0, D'3000.01.01');
   if(CustomRatesUpdate(g_sym, past) < 0)
   {
      PrintFormat("BarReplay: loading history failed (%d)", GetLastError());
      return INIT_FAILED;
   }
   SymbolSelect(g_sym, true);

   g_chart = FindChart(g_sym);
   if(g_chart == 0) g_chart = ChartOpen(g_sym, InpChartTF);
   else             ChartSetSymbolPeriod(g_chart, g_sym, InpChartTF);
   if(g_chart == 0)
   {
      PrintFormat("BarReplay: could not open replay chart (%d)", GetLastError());
      return INIT_FAILED;
   }

   ChartSetInteger(g_chart, CHART_AUTOSCROLL, true);
   ChartSetInteger(g_chart, CHART_SHIFT, true);
   if(InpTemplate != "") ChartApplyTemplate(g_chart, InpTemplate);

   Controls();
   Info();
   ChartRedraw(g_chart);

   if(!EventSetMillisecondTimer(25)) EventSetTimer(1);
   PrintFormat("BarReplay: ready on %s, %d bars to replay", g_sym, ArraySize(g_future));
   return INIT_SUCCEEDED;
}

//+------------------------------------------------------------------+
void OnDeinit(const int reason)
{
   EventKillTimer();
   if(g_chart != 0 && ChartSymbol(g_chart) != "")
   {
      ObjectsDeleteAll(g_chart, "RP_");
      ChartRedraw(g_chart);
   }
}

//+------------------------------------------------------------------+
void OnTick() {}

//+------------------------------------------------------------------+
void OnTimer()
{
   if(g_chart == 0) return;
   if(ChartSymbol(g_chart) == "")
   {
      Print("BarReplay: replay chart was closed. Re-attach the EA to start again.");
      g_chart = 0;
      EventKillTimer();
      return;
   }

   // Templates wipe objects, so rebuild the buttons if they disappear
   if(ObjectFind(g_chart, "RP_PLAY") < 0) Controls();

   if(Pressed("RP_NEXT")) NextCandle();
   if(Pressed("RP_SLOW") && g_speedIdx > 0) g_speedIdx--;
   if(Pressed("RP_FAST") && g_speedIdx < ArraySize(g_speeds) - 1) g_speedIdx++;

   bool playing = ObjectGetInteger(g_chart, "RP_PLAY", OBJPROP_STATE) != 0;
   if(playing && g_pos >= ArraySize(g_future))
   {
      playing = false;
      ObjectSetInteger(g_chart, "RP_PLAY", OBJPROP_STATE, false);
   }
   ObjectSetString(g_chart, "RP_PLAY", OBJPROP_TEXT, playing ? "Pause" : "Play");

   if(playing && GetTickCount() - g_lastStep >= (uint)g_speeds[g_speedIdx])
   {
      Push(1); // one 1-minute bar at a time, so candles build live
      g_lastStep = GetTickCount();
   }

   Info();
   ChartRedraw(g_chart);
}
//+------------------------------------------------------------------+
