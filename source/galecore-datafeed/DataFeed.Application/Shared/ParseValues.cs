using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace DataFeed.Application.Shared
{
    public static class ParseValues
    {
        public static decimal ParseDecimal(string input)
        {
            var resp = decimal.TryParse(input, NumberStyles.Any, CultureInfo.InvariantCulture, out var result) ? result : 0;
            return resp;
        }

        public static double ParseDouble(string input)
        {
            var resp = double.TryParse(input, NumberStyles.Any, CultureInfo.InvariantCulture, out var result) ? result : 0;
            return resp;
        }

        public static DateTime ParseDateTime(string input)
        {
            var resp = DateTime.TryParse(input, CultureInfo.InvariantCulture, DateTimeStyles.RoundtripKind, out var result) ? result : DateTime.MinValue;
            return resp;
        }

        public static long ParseLong(string input)
        {
            var resp = long.TryParse(input, NumberStyles.Any, CultureInfo.InvariantCulture, out var result) ? result : 0;
            return resp;
        }

        public static int ParseInt(string input)
        {
            var resp = int.TryParse(input, NumberStyles.Any, CultureInfo.InvariantCulture, out var result) ? result : 0;
            return resp;
        }
    }
}
