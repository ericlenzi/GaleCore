using MediatR;
using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace DataFeed.Application.Shared
{
    public class TastytradeHelper
    {
        public static string GetOptionSymbolFromTicker(string ticker)
        {
            return "." + ticker.Substring(0, 6).Trim(' ') + ticker.Substring(6, 6) + ticker.Substring(12, 1) + Convert.ToInt32(ticker.Substring(13, 5).TrimStart('0')).ToString();
        }

        public static string GetStockSymbolFromTicker(string ticker)
        {
            return ticker.Substring(0, 6).Trim(' ');
        }

        public static decimal GetStrikeFromTicker(string ticker)
        {
            string intpart = ticker.Substring(13, 5);
            string decpart = ticker.Substring(18, 3);
            decimal value = decimal.Parse(intpart) + decimal.Parse(decpart) / 1000;
            return value;
        }

        public static int GetDTEFromTicker(string ticker, DateTime priceTime)
        {
            var datePart = ticker.Substring(6, 6);

            if (!DateTime.TryParseExact(datePart, "yyMMdd",
                System.Globalization.CultureInfo.InvariantCulture,
                System.Globalization.DateTimeStyles.None, out DateTime expirationDate))
            {
                throw new ArgumentException($"Invalid date format in symbol: {datePart}");
            }

            // Calcular diferencia en días
            int dte = (expirationDate.Date - priceTime.Date).Days;

            return dte;
        }

        public static bool IsOptionSymbol(string ticker)
        {
            return (ticker.Length == 21 && (ticker.Substring(12,1) == "C" || ticker.Substring(12, 1) == "P")) ? true : false;
        }
    }
}
