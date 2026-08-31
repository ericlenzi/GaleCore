using DataFeed.Api.Controllers.Dtos;
using DataFeed.Infrastructure.Providers.Tastytrade;
using MediatR;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
//using Strateps.Application.Autenticacion;
//using Strateps.Domain.Enums;
using System;
using System.Linq;
using System.Security.Claims;
using System.Threading.Tasks;

namespace DataFeed.Controllers
{
    public class DataFeedControllerBase : ControllerBase
    {
        private IMediator mediator;
        // private CurrentUser currentUser;

        public DataFeedControllerBase(IMediator mediator)
        {
            this.mediator = mediator;
        }

        public async Task<IActionResult> Handle<TResponse>(IRequest<TResponse> request)
        {
            TResponse response;

            try
            {
                response = await this.mediator.Send(request);
            }
            catch (BrokerAccountNotLinkedException ex)
            {
                // 409 y no 500: que el operador todavía no haya vinculado su cuenta es un estado
                // esperado, no una falla del servidor. El `code` es lo que le permite al tablero
                // decir "vinculá tu cuenta" en vez de mostrar el error crudo.
                return this.Conflict(new ApiErrorResponse
                {
                    Error = ex.Message,
                    Code = BrokerAccountNotLinkedException.Code,
                });
            }
            catch (OptionChainNotFoundException ex)
            {
                // 409 por lo mismo: el símbolo que eligió el operador no se puede analizar, y eso es
                // una respuesta, no una caída. El `symbol` viaja aparte para que el front lo nombre
                // sin tener que parsear el mensaje.
                return this.Conflict(new ApiErrorResponse
                {
                    Error = ex.Message,
                    Code = OptionChainNotFoundException.Code,
                    Symbol = ex.Symbol,
                });
            }

            if (HttpMethods.IsGet(this.Request.Method))
            {
                if (response != null)
                {
                    return this.Ok(response);
                }

                return this.NotFound();
            }
            else if (HttpMethods.IsDelete(this.Request.Method) || HttpMethods.IsPut(this.Request.Method) || HttpMethods.IsPatch(this.Request.Method))
            {
                return this.NoContent();
            }
            else if (HttpMethods.IsPost(this.Request.Method))
            {
                return this.Created(this.Request.Path.ToUriComponent(), response);
            }
            else
            {
                return this.StatusCode(501); // NotImplemented
            }
        }

        //protected CurrentUser CurrentUser
        //{
        //    get
        //    {
        //        if (currentUser == null)
        //        {
        //            var Identity = HttpContext.User.Identity as ClaimsIdentity;
        //            currentUser = new CurrentUser()
        //            {
        //                Id = new Guid(Identity.Claims.Where(c => c.Type == ClaimTypes.NameIdentifier).Select(c => c.Value).SingleOrDefault()),
        //                UserName = Identity.Claims.Where(c => c.Type == ClaimTypes.Name).Select(c => c.Value).SingleOrDefault(),
        //                Rol = (RolEnum)Enum.Parse(typeof(RolEnum), Identity.Claims.Where(c => c.Type == ClaimTypes.Role).Select(c => c.Value).SingleOrDefault()),
        //                NumeroSucursal = Identity.Claims.Where(c => c.Type == ClaimTypes.UserData).Select(c => c.Value).SingleOrDefault(),
        //                NumeroPuesto = Identity.Claims.Where(c => c.Type == ClaimTypes.Surname).Select(c => c.Value).SingleOrDefault()
        //            };
        //        }

        //        return currentUser;
        //    }
        //}
    }
}