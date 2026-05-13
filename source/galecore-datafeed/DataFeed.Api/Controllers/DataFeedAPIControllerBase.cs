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
            var response = await this.mediator.Send(request);

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