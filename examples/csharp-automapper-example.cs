using AutoMapper;
using System;
using System.Collections.Generic;

namespace DataMapping
{
    // Source data structure classes
    public class SourceCustomer
    {
        public string Id { get; set; }
        public string FirstName { get; set; }
        public string LastName { get; set; }
        public string Email { get; set; }
        public SourceAddress Address { get; set; }
    }

    public class SourceAddress
    {
        public string Street { get; set; }
        public string City { get; set; }
        public string State { get; set; }
        public string ZipCode { get; set; }
    }

    // Target data structure classes
    public class TargetClient
    {
        public string ClientId { get; set; }
        public TargetName Name { get; set; }
        public string EmailAddress { get; set; }
        public TargetLocation Location { get; set; }
    }

    public class TargetName
    {
        public string First { get; set; }
        public string Last { get; set; }
    }

    public class TargetLocation
    {
        public string AddressLine { get; set; }
        public string City { get; set; }
        public string StateProvince { get; set; }
        public string PostalCode { get; set; }
    }

    // AutoMapper profile for configuring the mappings
    public class MappingProfile : Profile
    {
        public MappingProfile()
        {
            // Map SourceCustomer to TargetClient
            CreateMap<SourceCustomer, TargetClient>()
                .ForMember(dest => dest.ClientId, opt => opt.MapFrom(src => src.Id))
                .ForMember(dest => dest.EmailAddress, opt => opt.MapFrom(src => src.Email))
                .ForMember(dest => dest.Name, opt => opt.MapFrom(src => new TargetName
                {
                    First = src.FirstName,
                    Last = src.LastName
                }))
                .ForMember(dest => dest.Location, opt => opt.MapFrom(src => src.Address));

            // Map SourceAddress to TargetLocation
            CreateMap<SourceAddress, TargetLocation>()
                .ForMember(dest => dest.AddressLine, opt => opt.MapFrom(src => src.Street))
                .ForMember(dest => dest.StateProvince, opt => opt.MapFrom(src => src.State))
                .ForMember(dest => dest.PostalCode, opt => opt.MapFrom(src => src.ZipCode));
        }
    }

    // Sample implementation showing usage
    public class MappingExample
    {
        public static void Main()
        {
            // Configure AutoMapper
            var config = new MapperConfiguration(cfg => {
                cfg.AddProfile<MappingProfile>();
            });
            
            // Create mapper
            var mapper = config.CreateMapper();
            
            // Sample source data
            var sourceCustomer = new SourceCustomer
            {
                Id = "C12345",
                FirstName = "John",
                LastName = "Doe",
                Email = "john.doe@example.com",
                Address = new SourceAddress
                {
                    Street = "123 Main St",
                    City = "Seattle",
                    State = "WA",
                    ZipCode = "98101"
                }
            };
            
            // Perform mapping
            var targetClient = mapper.Map<TargetClient>(sourceCustomer);
            
            // Display results
            Console.WriteLine($"Mapped Client ID: {targetClient.ClientId}");
            Console.WriteLine($"Mapped Name: {targetClient.Name.First} {targetClient.Name.Last}");
            Console.WriteLine($"Mapped Email: {targetClient.EmailAddress}");
            Console.WriteLine($"Mapped Address: {targetClient.Location.AddressLine}, {targetClient.Location.City}, {targetClient.Location.StateProvince} {targetClient.Location.PostalCode}");
        }
    }
}
```
